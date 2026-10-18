// Durability (HR drift + output) v2 community edition for intervals.icu, Oct 2026. Method: HR expected from 60 s and 600 s lagged power,
// calibrated per ride on min 10-40 or first 400 kJ; drift = (HR - expected) / slope, in W and % CP. DS = 100 x OD x (1 - end drift / CP).
// Custom activity stream: 10 min rolling HR drift in % CP (null where not scored).
(function () {
  // ===================== SETTINGS =====================
  // CP and W' come from the FTP and W' in Settings > Power for this sport, as stored on the
  // activity when it was analysed. Update them after a test and every newly analysed ride
  // uses them; re-analyse an older ride to apply new values to it. Put a number here only
  // to override (CP in W, W' in kJ).
  var CP_OVERRIDE = null
  var WPRIME_OVERRIDE_KJ = null

  // YOUR HR SLOPE (bpm per watt). Leave null for your first 15 to 20 rides: the chart then
  // fits it on each ride and prints "HR slope" in its header. Note that number on steady
  // rides with a clean calibration (RMSE under 6 bpm), take the median, and enter it here,
  // e.g. var MY_HR_SLOPE = 0.29. From then on every ride uses the same slope.
  var MY_HR_SLOPE = null

  // Optional fresh 1 and 5 min power (W) to judge if a race started hard enough to score
  // output durability. Leave null to use your best this season before the ride.
  var MY_REF1 = null, MY_REF5 = null
  var ATHLETES = {}

  var TAU_FAST = 60, TAU_SLOW = 600      // s, HR lag time constants
  var BUCKET_S = 5                        // s, streams are averaged to this before analysis
  var MIN_MOVING_MIN = 60                 // rides shorter than this are not scored
  var MIN_OUTDOOR_KMH = 20                // outdoor 'Ride' slower than this is treated as MTB
  var ONSET_PCT = 5                       // % CP sustained drift that marks onset
  var CHECKPOINT_FROM = 500, CHECKPOINT_STEP = 250   // kJ
  var RACE_RE = /race|course|gran ?fondo|sim\b/i   // ride names treated as races (or tick the Race box)
  // ====================================================

  function num(v) { return (v === null || v === undefined || isNaN(v)) ? NaN : Number(v) }
  function median(a) { var b = a.slice().sort(function (x, y) { return x - y }); var n = b.length; if (!n) return NaN; return n % 2 ? b[(n - 1) / 2] : (b[n / 2 - 1] + b[n / 2]) / 2 }
  function percentile(a, q) { var b = a.slice().sort(function (x, y) { return x - y }); var h = (b.length - 1) * q / 100, l = Math.floor(h); return l + 1 < b.length ? b[l] + (h - l) * (b[l + 1] - b[l]) : b[l] }
  function lagged(p, dt, tau) {
    var out = new Array(p.length), a = NaN
    for (var k = 0; k < p.length; k++) {
      var x = isNaN(p[k]) ? 0 : p[k]
      if (isNaN(a)) a = x; else a += (1 - Math.exp(-dt[k] / tau)) * (x - a)
      out[k] = a
    }
    return out
  }
  function bestMean(p, mov, dur, lo, hi) {
    var mm = [], pp = []
    for (var i = 0; i < mov.length; i++) if (mov[i] >= lo && mov[i] <= hi) { mm.push(mov[i]); pp.push(p[i]) }
    if (mm.length < 2 || mm[mm.length - 1] - mm[0] < dur) return NaN
    var d = []; for (i = 1; i < mm.length; i++) d.push(mm[i] - mm[i - 1]); var md = median(d)
    var cs = [0]; for (i = 0; i < pp.length; i++) cs.push(cs[i] + pp[i])
    var best = NaN, j = 0
    for (var k = 0; k < mm.length; k++) {
      while (mm[k] - mm[j] > dur) j++
      if (mm[k] - mm[j] >= dur - 1.5 * md) { var v = (cs[k + 1] - cs[j]) / (k + 1 - j); if (isNaN(best) || v > best) best = v }
    }
    return best
  }
  function curveWatts(c, secs) { try { var w = c ? c.getWatts(secs) : null; return w ? Number(w) : NaN } catch (e) { return NaN } }

  function analyse(icu, keepSeries) {
    var act = icu.activity || {}, ss = icu.sportSettings || {}
    var R = { scored: false, reason: null, flags: [] }
    var type = String(act.type || "")
    var indoor = act.trainer === true || type.indexOf("Virtual") === 0
    if (!/Ride$/.test(type)) { R.reason = "Not a ride"; return R }
    if (type === "MountainBikeRide") { R.reason = "MTB rides are not scored"; return R }
    if (!indoor && act.average_speed && act.average_speed * 3.6 < MIN_OUTDOOR_KMH) { R.reason = "Average speed under " + MIN_OUTDOOR_KMH + " km/h (treated as MTB)"; return R }
    if ((act.moving_time || 0) < MIN_MOVING_MIN * 60) { R.reason = "Shorter than " + MIN_MOVING_MIN + " min"; return R }

    var CP = CP_OVERRIDE || num(act.icu_ftp) || num(ss.ftp)
    var WP = WPRIME_OVERRIDE_KJ || (num(act.icu_w_prime) || num(ss.w_prime)) / 1000
    if (!(CP > 0)) { R.reason = "No FTP/CP set"; return R }
    R.cp = CP; R.wp = WP

    var st = icu.streams
    var T = st.time, P = st.fixed_watts || st.watts, H = st.fixed_heartrate || st.heartrate
    if (!T || !P || !H) { R.reason = "Needs power and heart rate"; return R }
    // Read the raw streams once into BUCKET_S averages (keeps memory low in the field sandbox;
    // the Oct 16 validation used 2 to 8 s data). A pause > 30 s closes the bucket.
    var n0 = Math.min(T.length, P.length, H.length)
    var rd = [], prev = NaN
    for (var i = 0; i < n0 && rd.length < 600; i++) { var ti0 = num(T[i]); if (ti0 - prev > 0) rd.push(ti0 - prev); prev = ti0 }
    var K = Math.max(1, Math.round(BUCKET_S / (median(rd) || 1)))
    var t = [], p = [], hr = [], bsum = 0, bc = 0, hsum = 0, hc = 0, cnt = 0, lastT = NaN, aboveJ = 0
    for (i = 0; i < n0; i++) {
      var ti = num(T[i]); if (isNaN(ti)) continue
      if (cnt > 0 && ti - lastT > 30) { t.push(lastT); p.push(bc ? bsum / bc : NaN); hr.push(hc ? hsum / hc : NaN); bsum = bc = hsum = hc = cnt = 0 }
      var pv = num(P[i]), hv = num(H[i])
      if (!isNaN(pv)) { bsum += pv; bc++; var rdt = ti - lastT; if (rdt > 0 && rdt <= 30 && pv > CP) aboveJ += (pv - CP) * rdt }
      if (!isNaN(hv)) { hsum += hv; hc++ }
      cnt++; lastT = ti
      if (cnt >= K) { t.push(lastT); p.push(bc ? bsum / bc : NaN); hr.push(hc ? hsum / hc : NaN); bsum = bc = hsum = hc = cnt = 0 }
    }
    if (cnt > 0) { t.push(lastT); p.push(bc ? bsum / bc : NaN); hr.push(hc ? hsum / hc : NaN) }
    T = P = H = st = null
    var n = t.length

    // time base: pauses count as one sample
    var dts = []; for (i = 1; i < n; i++) if (t[i] - t[i - 1] > 0) dts.push(t[i] - t[i - 1])
    var med = median(dts), gap = Math.max(30, 3 * med)
    dts = null
    var dt = new Array(n), pz = new Array(n), kj = new Array(n), mov = new Array(n), ck = 0, cm = 0
    for (i = 0; i < n; i++) {
      var d = i ? t[i] - t[i - 1] : 0
      if (d > gap) d = med
      dt[i] = d; pz[i] = isNaN(p[i]) ? 0 : p[i]
      ck += pz[i] * d; cm += d; kj[i] = ck / 1000; mov[i] = cm
    }
    var pl = lagged(p, dt, TAU_FAST), ps = lagged(p, dt, TAU_SLOW)
    var ok = new Array(n), cal = new Array(n), ncal = 0
    for (i = 0; i < n; i++) {
      ok[i] = !isNaN(hr[i]) && hr[i] > 70 && pl[i] >= 0.45 * CP && mov[i] > 600
      cal[i] = ok[i] && mov[i] <= 2400 && kj[i] <= 400
      if (cal[i]) ncal++
    }
    var calMin = ncal * med / 60
    if (calMin < 10) { R.reason = "Calibration window too short (" + Math.round(calMin) + " valid min in the first 40 min / 400 kJ)"; return R }

    // HR model: hr = a + bf*P_lag60 + bs*P_lag600
    var A = ATHLETES[String((icu.athlete && icu.athlete.id) || act.icu_athlete_id || "")] || null
    var bf, bs
    if (MY_HR_SLOPE > 0) { bf = MY_HR_SLOPE / 1.26; bs = 0.26 * bf; R.model = "your slope" }
    else if (A) { bf = A.fast; bs = A.slow; R.model = "pooled" }
    else {
      // one-parameter fit: shape of the lag mix fixed (slow = 0.26 x fast), total slope fitted
      var RATIO = 0.26, mx = 0, my = 0
      for (i = 0; i < n; i++) if (cal[i]) { mx += pl[i] + RATIO * ps[i]; my += hr[i] }
      mx /= ncal; my /= ncal
      var sxx = 0, sxy = 0
      for (i = 0; i < n; i++) if (cal[i]) { var xx = pl[i] + RATIO * ps[i] - mx; sxx += xx * xx; sxy += xx * (hr[i] - my) }
      bf = sxx > 0 ? sxy / sxx : NaN
      if (!(bf > 0)) { R.reason = "Could not fit HR to power in the calibration window"; return R }
      bf = Math.min(Math.max(bf, 0.12), 0.40)   // keep total slope within 0.15 to 0.50 bpm/W
      bs = RATIO * bf
      R.model = "fitted on this ride"; R.flags.push("HR slope fitted on this ride only: set MY_HR_SLOPE after 15 to 20 rides")
      if (!(bf > 0.05)) { R.reason = "Could not fit HR to power in the calibration window"; return R }
    }
    var B0 = bf + bs
    var mod = new Array(n), sa = 0
    for (i = 0; i < n; i++) { mod[i] = bf * pl[i] + bs * ps[i]; if (cal[i]) sa += hr[i] - mod[i] }
    var a = sa / ncal
    var resid = new Array(n), driftW = new Array(n), se = 0, calPl = []
    for (i = 0; i < n; i++) {
      resid[i] = hr[i] - (a + mod[i]); driftW[i] = resid[i] / B0
      if (cal[i]) { se += resid[i] * resid[i]; calPl.push(pl[i]) }
    }
    R.a = a; R.slope = B0; R.calRmse = Math.sqrt(se / ncal); R.calMin = calMin
    if (R.calRmse > 6) R.flags.push("Noisy calibration (RMSE " + R.calRmse.toFixed(1) + " bpm)")

    // v2: score drift only in steady riding inside the calibrated power range
    var p10 = percentile(calPl, 10), sc = new Array(n)
    for (i = 0; i < n; i++) sc[i] = ok[i] && !((ps[i] - pl[i]) > 0.15 * CP) && pl[i] >= p10 - 30

    // 10 min trailing mean of drift over scored points
    var idx = []; for (i = 0; i < n; i++) if (sc[i]) idx.push(i)
    var dm = []; for (i = 1; i < idx.length; i++) dm.push(mov[idx[i]] - mov[idx[i - 1]])
    var mdm = dm.length ? median(dm) : 1, need = Math.max(5, 0.4 * 600 / Math.max(1, mdm))
    var roll = new Array(n); for (i = 0; i < n; i++) roll[i] = NaN
    var s = 0, c = 0, q0 = 0
    for (var qi = 0; qi < idx.length; qi++) {
      var k = idx[qi]; s += driftW[k]; c++
      while (mov[idx[q0]] < mov[k] - 600) { s -= driftW[idx[q0]]; c--; q0++ }
      roll[k] = c >= need ? s / c : NaN
    }

    // checkpoints every 250 kJ (mean drift in a +/-125 kJ window)
    var kjEnd = kj[n - 1], cps = []
    for (var cpk = CHECKPOINT_FROM; cpk <= Math.floor(kjEnd); cpk += CHECKPOINT_STEP) {
      var sum = 0, cnt = 0
      for (i = 0; i < n; i++) if (sc[i] && kj[i] >= cpk - 125 && kj[i] < cpk + 125) { sum += driftW[i]; cnt++ }
      if (cnt * med < 240) cps.push({ kj: cpk, drift: null })
      else { var dw = sum / cnt; cps.push({ kj: cpk, drift: dw, pct: 100 * dw / CP, hs: 100 * (1 - Math.max(dw, 0) / CP) }) }
    }

    // end drift: last 10 min of scored riding, excluding the final 5 min
    var tend = mov[n - 1] - 300, last = -1
    for (i = 0; i < n; i++) if (sc[i] && mov[i] <= tend) last = i
    var es = 0, ec = 0
    if (last >= 0) for (i = 0; i < n; i++) if (sc[i] && mov[i] <= tend && mov[i] >= mov[last] - 600) { es += driftW[i]; ec++ }
    var end = ec > 5 ? es / ec : NaN
    if (isNaN(end)) { R.reason = "Not enough steady riding near the end to score"; return R }

    var onset = null
    for (i = 0; i < n; i++) if (sc[i] && !cal[i] && roll[i] > ONSET_PCT / 100 * CP) { onset = kj[i]; break }

    // output durability: best 1 and 5 min, second half vs first half (by kJ); races only
    var ev = icu.pairedEvent
    var isRace = act.race === true || RACE_RE.test(String(act.name || "")) || !!(ev && /^RACE/.test(String(ev.category || "")))
    var ref1 = A ? A.ref1 : NaN, ref5 = A ? A.ref5 : NaN
    if (!A) { var bp = null; try { bp = icu.bestPowerBefore ? icu.bestPowerBefore["s0"] : null } catch (e) { } ref1 = MY_REF1 || curveWatts(bp, 60); ref5 = MY_REF5 || curveWatts(bp, 300) }
    var mh = mov[n - 1]; for (i = 0; i < n; i++) if (kj[i] >= kjEnd / 2) { mh = mov[i]; break }
    var od = [], efforts = []
    var durs = [[60, ref1], [300, ref5]]
    for (var di = 0; di < 2; di++) {
      var e = bestMean(pz, mov, durs[di][0], 600, mh), l = bestMean(pz, mov, durs[di][0], mh, mov[n - 1])
      efforts.push({ secs: durs[di][0], early: e, late: l, ref: durs[di][1] })
      if (isRace && !isNaN(e) && !isNaN(l) && e >= 0.7 * durs[di][1]) od.push(l / e)
    }
    var odv = 1
    if (od.length) { var so = 0; for (i = 0; i < od.length; i++) so += od[i]; odv = Math.min(1, so / od.length) }

    var above = aboveJ   // from the raw samples, before averaging
    R.scored = true
    R.isRace = isRace; R.hrOnly = !od.length; R.od = odv; R.efforts = efforts
    R.endW = end; R.endPct = 100 * end / CP
    R.ds = 100 * odv * (1 - Math.max(end, 0) / CP)
    R.onsetKj = onset; R.kj = kjEnd; R.cpHours = kjEnd * 1000 / CP / 3600
    R.aboveKj = above / 1000; R.wpMult = WP > 0 ? above / 1000 / WP : NaN
    R.checkpoints = cps; R.indoor = indoor
    if (end < -0.05 * CP) R.flags.push("HR below expected late (" + Math.round(end) + " W)")
    if (!keepSeries) return R
    R.s = { n: n, t: t, mov: mov, kj: kj, pz: pz, pl: pl, hr: hr, pred: mod.map(function (v) { return v + a }), driftW: driftW, roll: roll, sc: sc, cal: cal }
    return R
  }

  var R = analyse(icu, true)
  var dn = data.length, dtime = data.time
  for (var j = 0; j < dn; j++) data[j] = null
  if (R.scored) {
    var s = R.s, k = 0
    for (j = 0; j < dn; j++) {
      var tj = dtime ? dtime[j] : j
      while (k < s.n - 1 && s.t[k + 1] <= tj) k++
      data[j] = isNaN(s.roll[k]) ? null : Math.round(1000 * s.roll[k] / R.cp) / 10
    }
  }
})()
