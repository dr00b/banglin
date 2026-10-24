# How many symptoms can a tap language carry?

Research brief for Mr Morse (`apps/mr-morse`): how much a patient can realistically encode by tapping the watch, what Morse code's history teaches about learnable codes, and a proposed language with a demo for learning it (`demo/`).

## Bottom line

- **Three symptoms, three severities.** Nine messages, each one tap group of 1–3 for *what* and one of 1–3 for *how bad*. Every group stays inside the range people count at a glance (≤3–4), and the whole mapping fits in working memory (~4 items).
- **A fourth symptom only as a catch-all** ("flare / everything is bad"). It should be optional and taught last.
- **Five is out.** Five taps cannot be counted at a glance, five items fill working memory, and no evidence shows patients need five distinct real-time codes. Rarer symptoms belong in a later phone review, not the tap code.
- **Real-time capture is the reason to tap.** Paper diaries look complete but are often back-filled ([Stone 2002](#s9)), so a code the patient can send in two seconds without looking is worth more than a long code.

## 1. What patients log, and how much they can handle

### Which symptoms come up

The same three kinds of symptom lead across conditions: a **site-specific pain**, a **second physical symptom** (bloating, stiffness or swelling) and **fatigue**.

| Condition | Most common / most important | Source |
|---|---|---|
| Menstrual cycle (6,141 app users) | Cramps 83%, bloating 63%, tiredness 61%, acne 54%, headache 53% | [Apple Women's Health Study](#s1) |
| Menstrual apps (20 iOS apps) | Apps offer 10+ symptoms; headache, cramps and acne are near-universal; wording varies widely | [Adnan 2021](#s2) |
| PMDD (DRSP diary) | Irritability 76%, anxiety 71%, tiredness 58%, mood swings 58% | [Sertraline trial baseline](#s3) |
| Rheumatoid arthritis flare | Patients and clinicians rate pain (93%), function, swollen joints, tender joints, stiffness (79%) essential; fatigue 68% | [OMERACT flare Delphi, Bartlett 2012](#s4) |
| Lupus flare (patient-defined) | Joint pain, fatigue, skin problems lasting several days | [2024 qualitative study](#s5) |

The frequency distribution is steep. The first three menstrual symptoms each reach a majority of loggers, and the RA list is already ranked by patients. The top three cover most of what a person would log in the moment.

### How much logging burden is too much

- **Item count matters less than expected.** A meta-analysis of 105 mobile EMA datasets found ~82% compliance and no compelling link between items per prompt and compliance ([Williams 2021](#s6)). A 2024 experiment found none either ([JMIR 2024](#s7)).
- **Short RA diaries work.** Patients rating two items (pain, stiffness) seven times a day reached ~94% verified compliance ([J Rheumatol](#s8)). An online RA community using a single "worse than usual?" item got 60% of daily check-ins, 75% during flares ([ISPOR 2026](#s10)).
- **Recall is the real failure.** In a sensor-instrumented paper pain diary, patients reported ~90% compliance but actually opened it on time ~11% of the time; the electronic diary reached 94% ([Stone 2002](#s9)). What matters is capturing the event when it happens.

### Limits of a tap code

A tap code differs from a questionnaire. Nothing on screen prompts the patient, so they must recall the mapping, produce a count and trust it.

- **Working memory holds about 4 chunks**, not 7 ([Cowan 2001](#s11)). Three symptom codes plus "severity comes next" fits. Five does not.
- **People can tell about 5–6 levels on one dimension** without confusion (~2.6 bits) ([Miller 1956](#s12)). Tap count is a single dimension, so 3 symptoms × 3 severities stays well inside it.
- **Touch is counted at a glance up to 3–4** ([Cohen 2014](#s13); [Subitizing](#s14)). Above that, people count serially and make errors, especially when distracted or in pain.
- **Severity scales.** Clinic pain scales run 0–10, but verbal scales (mild / moderate / severe) are valid and easier to use ([Hjermstad 2011](#s15)). Three levels keep the severity group the same size as the symptom group. Mr Morse currently uses 1–5, which exceeds the at-a-glance range.

## 2. What made Morse code easier to use

| Innovation | When | What it did | Rule for our code |
|---|---|---|---|
| Frequency-ranked code | ~1838, Vail | Counted printers' type: E got one dot, T one dash ([Morse code](#s16)); within ~15% of optimal | The patient's most frequent symptom gets 1 tap |
| Continental / International Morse | 1848 Gerke; 1865 Paris | Removed American Morse's internal spaces and multiple dash lengths; one dot-unit gap inside a letter ([Gerke](#s17)) | One kind of gap inside a group, one longer gap between groups. No fine timing |
| Prosigns | 1860s on | Procedure signals: K "go ahead", R "received", AR "end", SK "goodbye" ([Prosigns](#s18)) | Password = start; buzz-back = "received"; long buzz = "nothing logged" |
| 92 Code | 1857–59, Western Union | Whole messages as numbers: 30 "end", 73 "best regards" ([Wire signal](#s19)) | An optional single code for a common compound message ("flare") |
| Phillips Code | 1879, AP | Compiled abbreviations from operators' own practice (SCOTUS, POTUS) ([Phillips Code](#s20)) | The patient picks their own three symptoms from their own history |
| Q codes | 1909–1912 | Fixed three-letter questions and answers, the same in every language ([Prosigns](#s18); [Abbreviations](#s21)) | Fixed slot order: symptom, then severity |
| Koch method | 1936 | Learn each character as a whole sound at full speed; start with two characters, add one at 90% accuracy; avoid confusable pairs; charts are a crutch ([Koch summary](#s22); [LICW 2.2](#s23)) | Practice mode unlocks symptoms one at a time at 90% |
| Farnsworth spacing | 1950s | Full-speed characters, extra space between them, shrinking with skill ([Tauber](#s24)) | Generous pause between groups (1 s+) |
| Tap code | 1965, Hanoi POWs | Letters as two tap counts (row, column) on a 5×5 grid; learned from "AFLQV"; used to report who was hurt ([Tap code](#s25); [NVMM](#s26)) | Closest analogue: two count groups, nothing but taps |

The tap code matters most. Its users had only knocks, as Mr Morse does: the watch's accelerometer reports impacts, not presses, so there is no dash (see `apps/mr-morse/README.md`). They succeeded with two short count groups and a pause between them, which is the structure proposed here.

## 3. The proposed language: TAP-3

```
password     symptom        severity
• •  •   ⟶  buzz   •          •          1 = mild
                   • •        • •        2 = moderate
                   • • •      • • •      3 = severe
            (ack)  └─ ≥1 s pause ─┘   └─ 2.5 s quiet: watch echoes, logs
```

1. **Frame.** Mr Morse's password (dot-dot … dot), unchanged. The watch buzzes it back as the "go ahead" prosign.
2. **Symptom:** 1–3 taps. The patient's top three, ordered by frequency (Vail): menstrual default = cramps / bloating / fatigue; RA default = joint pain / stiffness / fatigue.
3. **Pause** of at least 1 s, Farnsworth-style.
4. **Severity:** 1–3 taps (mild / moderate / severe).
5. **Echo.** After 2.5 s quiet the watch replays symptom and severity and logs it. A wrong echo is the patient's signal to delete it later. Example: bloating, moderate = `•• •` … buzz … `••` · `••`.
6. **Cancel.** Silence after the password, or too many taps in a group, gives a long buzz and logs nothing, as Mr Morse does now.
7. **Optional catch-all:** 4 taps in the symptom slot = "flare", off by default and taught last (92 Code idea).

Changes needed on the watch later (not part of this branch): a second count group in `lib/morse-protocol.js` split on a ≥1 s gap, and a 3-level severity.

## 4. Remembering and practising it

- **Card for lookup, practice for fluency.** Koch warned that a chart builds a slow lookup habit, so the wallet card is a backstop. Fluency comes from producing the code.
- **Retrieval practice beats re-reading.** After a week, repeatedly testing yourself beats repeatedly studying ([Roediger & Karpicke 2006](#s27)). Spacing those tests over days helps clinicians retain what they learn ([Larsen review](#s28)).
- **What the demo does:** a printable credit-card-size card built from the patient's own setup; a Koch-style drill that starts with two symptoms and unlocks the third at 90%, drawing the weakest code most often; a "listen" drill where the app plays a code and the patient names it, mirroring the watch's echo; and a daily review reminder that lengthens 1 → 2 → 4 → 7 days while accuracy holds.

## 5. Limits and next step

No study has tested blind tap-coding of symptoms. The numbers above come from adjacent work: diaries, EMA, working memory and touch perception. Most Morse learning evidence is practitioner writing plus Koch's 1936 report. A small pilot would settle it: about 10 patients for two weeks, each tap-logging and also confirming on the phone, measuring how often the code, the echo and the phone entry agree.

## Sources

1. <a id="s1"></a>Harvard T.H. Chan / Apple Women's Health Study, "Menstrual symptom data can help end period stigma." https://hsph.harvard.edu/research/apple-womens-health-study/study-updates/menstrual-symptom-data-can-help-end-period-stigma/
2. <a id="s2"></a>Adnan T, Coull BA, Jukic AM, Mahalingaiah S. The real-world applications of the symptom tracking functionality available to menstrual health tracking apps. *Curr Opin Endocrinol Diabetes Obes* 2021;28(6):574–586. https://pmc.ncbi.nlm.nih.gov/articles/PMC8631160
3. <a id="s3"></a>Sertraline in PMDD trial (DRSP baseline), NCT00536198. https://clinicaltrials.gov/study/NCT00536198
4. <a id="s4"></a>Bartlett SJ et al. Identifying core domains to assess flare in rheumatoid arthritis: an OMERACT international patient and provider combined Delphi consensus. *Ann Rheum Dis* 2012;71(11):1855. https://ard.bmj.com/content/71/11/1855
5. <a id="s5"></a>SLE flares from patient and clinician perspectives, 2024. https://www.pubmed.ncbi.nlm.nih.gov/38101916/
6. <a id="s6"></a>Williams MT et al. Compliance with mobile ecological momentary assessment of self-reported health-related behaviors and psychological constructs in adults: systematic review and meta-analysis. *JMIR* 2021;23(3):e17023. https://pmc.ncbi.nlm.nih.gov/articles/PMC7970161
7. <a id="s7"></a>JMIR 2024, EMA prompts and items vs compliance. https://jmir.org/2024/1/e50275/PDF
8. <a id="s8"></a>Electronic diary compliance for pain and stiffness in rheumatic disease. *J Rheumatol*. https://www.jrheum.org/node/37931
9. <a id="s9"></a>Stone AA et al. Patient non-compliance with paper diaries. *BMJ* 2002;324:1193. https://www.bmj.com/content/324/7347/1193
10. <a id="s10"></a>Characterizing autoimmune flares among individuals with RA in an online community. ISPOR 2026. https://www.ispor.org/heor-resources/presentations-database/presentation-cti/ispor-2026/poster-session-3-3/characterizing-autoimmune-flares-in-real-world-settings-among-individuals-with-rheumatoid-arthritis-enrolled-in-an-online-community
11. <a id="s11"></a>Cowan N. The magical number 4 in short-term memory. *Behav Brain Sci* 2001;24:87–185. https://memory.psych.missouri.edu/assets/doc/articles/2001/cowan-bbs-2001.pdf
12. <a id="s12"></a>Miller GA. The magical number seven, plus or minus two. *Psychol Rev* 1956;63:81–97. https://www.yorku.ca/pclassic/Miller/
13. <a id="s13"></a>Cohen Z, Naparstek S, Henik A. Tactile enumeration of small quantities using one hand. 2014. https://cris.biu.ac.il/en/publications/tactile-enumeration-of-small-quantities-using-one-hand/
14. <a id="s14"></a>Subitizing (tactile section). https://en.wikipedia.org/wiki/Subitizing
15. <a id="s15"></a>Hjermstad MJ et al. Studies comparing NRS, VRS and VAS for assessment of pain intensity in adults: a systematic literature review. *J Pain Symptom Manage* 2011;41(6):1073–1093. https://doi.org/10.1016/j.jpainsymman.2010.08.016
16. <a id="s16"></a>Morse code (Vail's type-case count). https://en.wikipedia.org/wiki/Morse_code
17. <a id="s17"></a>Friedrich Clemens Gerke. https://en.wikipedia.org/wiki/Friedrich_Clemens_Gerke
18. <a id="s18"></a>Prosigns for Morse code. https://en.wikipedia.org/wiki/Prosigns_for_Morse_code
19. <a id="s19"></a>Wire signal (92 Code). https://en.wikipedia.org/wiki/Wire_signal
20. <a id="s20"></a>Phillips Code. https://en.wikipedia.org/wiki/Phillips_Code
21. <a id="s21"></a>Morse code abbreviations. https://en.wikipedia.org/wiki/Morse_code_abbreviations
22. <a id="s22"></a>Executive summary of Koch (1936). Long Island CW Club. https://longislandcwclub.org/wp-content/uploads/2022/11/EXECUTIVE-SUMMARY-KOCH-1936.pdf
23. <a id="s23"></a>The LICW Method Guide 2.2. https://longislandcwclub.org/wp-content/uploads/2026/08/THE-LICW-METHOD-GUIDE-2.2.pdf
24. <a id="s24"></a>Tauber J. Learning Morse code (Koch vs Farnsworth). https://jtauber.com/blog/2007/03/27/learning_morse_code
25. <a id="s25"></a>Tap code. https://en.wikipedia.org/wiki/Tap_code
26. <a id="s26"></a>National Vietnam War Museum, "The Vietnam Tap Code." https://nationalvmm.org/?p=17692
27. <a id="s27"></a>Roediger HL, Karpicke JD. Test-enhanced learning. *Psychol Sci* 2006;17(3):249–255. https://doi.org/10.1111/j.1467-9280.2006.01693.x
28. <a id="s28"></a>Retrieval practice and spaced repetition in medical education. *Perspect Med Educ* 2015. https://link.springer.com/article/10.1007/s40037-015-0220-x
