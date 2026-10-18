# Durability score for intervals.icu (power + heart rate)

An empirical durability score for cyclists, computed from your own rides in intervals.icu. It looks at two things: how much your heart rate drifts above what it should be for the power you ride (the internal cost), and for races, whether your best 1 and 5 min power held in the second half (the output).

This is a community test. It is not validated in a lab. Feedback goes to the intervals.icu forum thread: [THREAD LINK].

## How it works

1. During the first 30 to 40 minutes of a ride (or the first 400 kJ), the script learns how your heart rate follows your power. HR reacts slowly, so it uses power delayed by about 1 and 10 minutes.
2. For the rest of the ride, it compares your real HR with the HR expected for the power you ride.
3. Extra beats are converted into watts (extra beats ÷ your HR slope) and shown as a % of CP. That's the drift.
4. Durability score = 100 × output ratio × (1 − end drift ÷ CP). Outside races, the output ratio is 1 and the score is HR only.

Results are plotted against cumulative work (kJ), so rides of different length can be compared at the same work done. Always read a score with its dose: a higher score at the same or more kJ is progress.

## Files

| File | intervals.icu feature | What it gives |
|---|---|---|
| `durability-chart.js` | Custom activity chart | Drift (% CP) against kJ, observed vs expected HR, 60 s power. The header shows the score, end drift, onset, dose and your HR slope. |
| `durability-field.js` | Computed activity field | The score for each ride, for the activity list and the Fitness page. |
| `durability-stream.js` | Custom activity stream (optional) | 10 min rolling drift, to overlay on the activity timeline. |

## Installation

1. **CP and W′:** put your CP in the FTP box in Settings, Power (Ride), along with your W′. The scripts read them from each activity.
2. **Chart:** open a ride, Power tab, Charts at the bottom, Add custom chart. Paste the whole of `durability-chart.js` (it must end with `})()`). Height 560 px.
3. **Score field:** on an activity, Custom under the timeline, add a field. Name `Durability`, code `DurabilityDS`, type number. Paste `durability-field.js`. New rides are scored when analysed; for past rides, select them in the Activities list and click Analyze.
4. **Drift stream (optional):** Charts, Custom Streams, Add Stream, code `hr_drift`, units `% CP`, script stream. Paste `durability-stream.js`.

Scored rides: road, gravel and indoor, 60 min or more, with power and a chest strap HR. MTB and outdoor rides under 20 km/h average are not scored.

## Set your HR slope

The slope (bpm per watt) is personal, typically 0.2 to 0.45. If it is left to be fitted on each ride, it is noisy, and an underestimated slope makes drift look bigger than it is. Set it once with one of these methods, in both the chart and the field scripts:

**Method A, from your rides.** Leave `var MY_HR_SLOPE = null` for 15 to 20 rides. Note the `HR slope` value in the chart header on steady rides with calibration RMSE under 6 bpm. Enter the median: `var MY_HR_SLOPE = 0.29`.

**Method B, step test.** Fresh, after a 15 min warm-up, ride 3 steady steps of 10 min at about 50%, 60% and 70% of CP (ERG indoors is ideal). Average power and HR over the last 5 minutes of each step. Slope = (HR step 3 − HR step 1) ÷ (power step 3 − power step 1). Example: 118 bpm at 150 W and 136 bpm at 210 W gives 18 ÷ 60 = 0.30.

Redo it after a big change in fitness.

## Other settings (top of each script)

| Setting | Default | Use |
|---|---|---|
| `MY_HR_SLOPE` | `null` | Your HR slope, bpm/W (see above). |
| `MY_REF1`, `MY_REF5` | `null` | Fresh 1 and 5 min power (W) to judge if a race started hard enough to score output. Null uses your best this season before the ride. |
| `CP_OVERRIDE`, `WPRIME_OVERRIDE_KJ` | `null` | Freeze CP (W) and W′ (kJ) instead of reading them from the activity. |
| `RACE_RE` | race, course, gran fondo, sim | Ride names treated as races. Ticking the Race box or pairing with a RACE event also works. |

Keep the settings identical in all the scripts you use.

## Known limits

Heat, sleep, caffeine, hydration and stress all move heart rate. They are not corrected on purpose, because they are real costs, but note them when a score looks odd. Wrist optical HR is not reliable enough. A race that starts full gas gives a short, noisy calibration.

## Optional check

On a long ride, ride 10 min at a fixed power (about 70 to 75% CP) early, then the same 10 min at the same power after about 2,000 kJ. The HR difference is the classic drift measurement. Compare it with the script's drift at the same point and report both.

## Background

The core idea follows published work showing HR decoupling at fixed power is a strong marker of first ventilatory threshold durability (Rothschild et al., Eur J Appl Physiol, 2025). This version works with variable power, which has not been validated.

Author: Jean-Yves (@jyhudon). MIT licence, see LICENSE.
