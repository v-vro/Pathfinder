# Pathfinder: how far can we trust the segmented anatomy?

Answer to "how are you sure the fissures, arteries, veins and airways are accurate, just from a CT scan?"
**Short answer: we aren't, and the literature tells us roughly how wrong to expect each structure to be.**
Every number below was read in the cited source (abstract, full text, or the TotalSegmentator repo) during
this search (Nov 2026). "Not found" means I looked and found no number. **solid** = peer-reviewed, adequate n,
directly applicable; **shaky** = small n, different model/population, preprint, repo file, or second-hand.

Caveat on metrics: Dice measures volume overlap and is dominated by big structures. A lobe Dice of 0.97 can
coexist with a fissure that sits several mm off. Boundary metrics (rHd95, NSD at x mm) matter more for needle paths.

## 1. Lung lobes and the inferred fissures (TotalSegmentator `total`)

| Metric | Value | Dataset | Source | Conf. |
|---|---|---|---|---|
| Mean Dice, all 104 structures | 0.943 (95% CI 0.938–0.947); NSD (3 mm tolerance) 0.966 | 65 held-out test pts, same Basel hospital as training (1,204 CTs, mixed phases) | Wasserthal, Radiol Artif Intell 2023, PMID 37795137, DOI 10.1148/ryai.230024 | solid (in-distribution) |
| Per-lobe Dice, v1 paper model | RUL 0.944, RML 0.975, RLL 0.988, LUL 0.971, LLL 0.985 | same test set | repo `resources/results_all_classes_v1.json` (paper supplement per README) | solid |
| Per-lobe NSD (3 mm), v1 | RUL 0.961 (lowest); others 0.976–0.994 | same | same file | solid |
| Per-lobe Dice, v2-era eval output | RUL **0.893**, RML 0.966, RLL 0.975, LUL 0.968, LLL 0.979; surface Dice (3 mm) RUL 0.928, others 0.971–0.980 | not stated in file (output of repo `evaluate.py`) | repo `resources/evaluate_results.txt` (Sep 2023) | shaky (undocumented) |
| External, easy cases (fissures clearly visible) | DSC mean 0.95 (median 0.97); **rHd95 mean 7.49 mm (median 5.08)**; NSD (2 mm) 0.88 | 42 of 164 clinical CTs, 0.8–5.0 mm slices, heavy disease | Amini & Klein, Eur Radiol Exp 2025, PMID 40908427, DOI 10.1186/s41747-025-00623-9 | solid (1 centre) |
| External, moderate cases | DSC 0.94 (0.96); rHd95 11.52 mm (median 7.16); NSD 0.85 | 41 CTs | same | solid |
| External, hard cases | DSC 0.80 (0.94); rHd95 19.06 mm (median 10.35); NSD 0.72 | 81 CTs | same | solid |
| Missing lobe (lobectomy / collapse) | TotalSegmentator predicted the absent lobe in **35/35** cases | same cohort | same | solid |
| Where errors concentrate | "under-segmentation of the RML, caused by difficulty in detecting the right horizontal fissure, in turn leads to RUL over-segmentation"; RML and RUL underperform in every difficulty class | same | same | solid (qualitative) |
| LOLA11 external (n=55) | Shown only as IoU box plots; no TotalSegmentator number read | LOLA11 | same | not found |
| Different model, COPD | Dice RUL 0.95, **RML 0.90**, RLL 0.97, LUL 0.97, LLL 0.97 | 24 COPD CTs | Xue, Sensors 2022, PMID 36366258 | shaky (other model) |
| Fissure-boundary error split by complete vs incomplete fissure | — | — | — | not found |

Also from the repo's `class_details.md`: with pleural effusion, lobe masks "often contain part of the pleural effusion".

## 2. How often fissures are incomplete on CT (% of scans with an incomplete fissure)

| Study | n | Left major | Right major | Right minor | Source | Conf. |
|---|---|---|---|---|---|---|
| Aziz 2004 | 662 | 43% | 48% | 63% (minor seen in only 78%) | J Thorac Imaging, PMID 15273615, numbers via van Rikxoort table | solid (second-hand) |
| Gülsün 2006 | 144 | 59.7% | 62.5% | — | via van Rikxoort 2012 table | shaky (second-hand) |
| Mahmut 2007 | 1000 | 18.6% | 17.4% | 20.4% (incomplete = >1 cm missing) | via van Rikxoort 2012 table | shaky (second-hand) |
| Ozmen 2010 | 387 | 48.3% | 69.7% | 86.9% | via van Rikxoort 2012 table | shaky (second-hand) |
| Cronin 2010 | 150, disease-free, 1.25 mm MDCT | 25.3% | 34.0% | 48.3% (minor absent 3.3%); κ for continuity 0.96 | Eur J Radiol, PMID 19896788 (table via van Rikxoort) | solid |
| Tuğtağ Demir 2025 | 288 | 27.1% | 31.3% | 35.1% | Radiologie, PMID 40216637 | solid-ish |
| van Rikxoort 2012 | 96, severe emphysema | 33% | 51% | 85% (complete: 67 / 49 / 15%) | Eur Radiol, PMID 21984417 | solid (COPD only) |
| Extent when incomplete | Major fissures mostly 10–30% incomplete; Gülsün: ~70% of incomplete majors were 1–25% incomplete, none >75% | — | — | — | van Rikxoort 2012 | solid-ish |

Across studies: left major 18.6–59.7%, right major 17.4–69.7%, right minor 20.4–86.9%. The right minor fissure is
the least reliable, and it is the same boundary where TotalSegmentator's RML/RUL errors concentrate.

## 3. Ribs (TotalSegmentator `total`)

| Metric | Value | Dataset | Source | Conf. |
|---|---|---|---|---|
| Per-rib Dice, v1 | 0.904 (left 12) to 0.979 (right 2); NSD (3 mm) 0.930–0.999 | paper test set | repo `results_all_classes_v1.json` | solid |
| Per-rib Dice, v2-era | 0.910 (left 5) to 0.967 (right 10); costal cartilages 0.919; sternum 0.906 | undocumented | repo `evaluate_results.txt` | shaky |
| Known failure modes | "the start of the ribs close to the spine is always missing a small part"; "the end of the ribs at the costal cartilages is not properly defined"; paper: "mixing up neighboring vertebrae and ribs" | — | repo `improvements_in_v2.md`; Wasserthal 2023 | solid (developer statement) |
| Independent external rib validation | — | — | — | not found |

## 4. Vessels and airways (`lung_vessels` task)

The README says `lung_vessels` is "partly based on" Liu et al. 2025 (AirRC) and asks users to also cite Kirchhoff
et al. (ECCV 2024, Skeleton Recall loss; that paper has no lung results). **No accuracy figure for TotalSegmentator's
`lung_vessels` model itself was found.** AirRC numbers below are the dataset authors' own model, so treat them as a proxy.

| Metric | Value | Dataset | Source | Conf. |
|---|---|---|---|---|
| AirRC 5-fold CV Dice | veins 0.953, arteries 0.950, airway lumen 0.941, **airway wall 0.866** | 254 LUNA16 CTs (subset of LIDC-IDRI), resampled to 1 mm; contrast status not stated | Liu, Sci Data 2025, PMID 41253855, DOI 10.1038/s41597-025-06074-6 | shaky as proxy |
| AirRC external Dice | arteries 0.802 (Parse2022), 0.816 (HiPaS); veins 0.786 in text / 0.789 in table (HiPaS); airway 0.821 on ATM'22 (recall 0.977, precision 0.711) | external sets | same | shaky as proxy |
| AirRC annotation | coarse auto masks refined by 2 observers (5 and 11 yrs), senior arbiter (15 yrs); inter-observer agreement not reported | — | same | — |
| VESSEL12 vessel detection | median algorithm Az 0.932; top 5 > 0.93 sensitivity and specificity; no significant contrast vs non-contrast difference | 20 CTs, point annotations | Rudyanto, Med Image Anal 2014, PMID 25113321 | solid (older methods) |
| VESSEL12 hard categories | small vessels worse than large; vessel vs dense lesion median Az 0.625; **vessel vs nodule median Az 0.461** | same | same | solid |
| Vessel sizing on a phantom | median radius error 0.062 ± 0.020 mm, IQR 0.199 ± 0.050 mm (CT voxels 0.38 × 0.38 × 0.5 mm) | 3D-printed phantom, vessels ~10 mm to ~0.2 mm | Zhai, Med Phys 2019, PMID 31206181, DOI 10.1002/mp.13659 | shaky (phantom, best case) |
| Vessel clDice, non-contrast | clDice 0.925, recall 0.949 (CTPA: 0.892 / 0.924) | 427 annotated CTs | Ming, arXiv 2503.16988 (Med Phys 2026) | shaky (abstract only) |

## 5. Artery vs vein separation on non-contrast CT

| Metric | Value | Dataset | Source | Conf. |
|---|---|---|---|---|
| Median accuracy | 89%, "closely approximating inter-observer agreement" | CARVE14: 55 non-contrast CTs, randomly selected vessels labelled by 2 observers | Charbonnier, IEEE TMI 2016, PMID 26584489, DOI 10.1109/TMI.2015.2500279 | solid |
| A/V Dice / accuracy | DSC 82.4 ± 3.0%; accuracy 90.3% (95% CI 87.7–92.9); branches detected 85.4%, tree length 90.9% | CARVE14 (10 fully labelled test scans, 0.7 mm spacing) | Qin, IEEE TMI 2021, PMID 33635786 | solid-ish |
| Accuracy | 90.1% on CARVE14; 96.2% on a private set | CARVE14 + local | Pan, PeerJ Comput Sci 2023, PMID 37810355 | shaky |
| Accuracy | 94% overall | 18 non-contrast cases, right upper and lower lobes only | Nardelli, IEEE TMI 2018, PMID 29993996 | shaky (small) |
| Sensitivity | ~98% vs one expert | 15 test CTs | Pu, Med Image Anal 2022, PMID 35066393 | shaky |
| Dice (HiPaS) | average 91.8%, sensitivity 98.0%; non-contrast reported non-inferior to CTPA | 1,073 CTs | Chu, Nat Commun 2025, DOI 10.1038/s41467-025-56505-6 | solid-ish (abstract) |

## 6. Airways, and the smallest calibre CT can show

| Metric | Value | Dataset | Source | Conf. |
|---|---|---|---|---|
| EXACT'09 tree length | no algorithm extracted more than an average of 74% of reference tree length | 20 CTs, 15 algorithms | Lo, IEEE TMI 2012, PMID 22855226 | solid (old methods) |
| ATM'22 top-10, test | tree length 85.2–97.9%, branches 75.7–97.1%, DSC 90.9–95.0%; winner 95.9 / 94.7 / 93.9% | 500 CTs (LIDC-IDRI + Shanghai Chest Hospital), 0.45–1.0 mm slices | Zhang, Med Image Anal 2023, PMID 37716199 | solid |
| Where methods disagree | "the disparity usually happened in the peripheral airways, especially the fifth/sixth generation" | same | same | solid |
| Branches / tree length on EXACT'09 | BD 76.7 ± 11.5%, TD 72.7 ± 11.6% | EXACT'09 test | Qin 2021 | solid-ish |
| Small airways | small airways (<2 mm diameter) drive COPD airflow limitation, and these airways "are below the resolution of the CT scanner"; in-plane pixel about 0.5 mm | review | Coxson, Proc Am Thorac Soc 2008, PMID 19056721 | solid (review) |
| Airway wall measurement | accuracy falls for walls <1.0 mm thick | phantom, 4 scanners | Oguma, PLoS One 2013, PMID 24116105 | solid |
| Validated mm detection limit for automated vessel segmentation | — (VESSEL12 defines "small" by HU, not mm) | — | — | not found |

## 7. Public datasets for validating Pathfinder's segmentations

| Structure | Dataset | What / access (verified on site or paper) |
|---|---|---|
| Lobes | LOLA11 | 55 CTs. Register, download scans, submit; reference kept private (Amini 2025) |
| Lobes | Amini 2025 | CT + lobe + trachea labels, Zenodo 10.5281/zenodo.12690802 (labels still being revised) |
| Lobes | Tang 2019 (ISBI) / Xue 2022 | 50 manually labelled LUNA16 scans / 24 COPD CTs; hosting not verified |
| Fissures | — | No dedicated public fissure ground truth found. Derive from lobe-label boundaries (our modelling choice) |
| Vessels | VESSEL12 | 20 CTs with point annotations, plus 3 example scans with reference; closed 1 Nov 2019, data still downloadable |
| A/V | CARVE14 | 55 non-contrast CTs (via ANODE challenge or site); all manual annotations public; 10 full + 45 partial (Qin 2021) |
| A/V + airways | AirRC | 254 LUNA16 CTs; labels CC-BY 4.0 on Figshare 10.6084/m9.figshare.26878867; images from LUNA16 |
| Airways | EXACT'09 | 20 test CTs; scored by submission on grand-challenge |
| Airways | ATM'22 | 500 CTs; register and send a signed data agreement (atm22.grand-challenge.org) |

**Overlap warning:** LUNA16 is 888 LIDC-IDRI scans (Setio, Med Image Anal 2017, DOI 10.1016/j.media.2017.06.015).
AirRC is built from LUNA16, and ATM'22 also draws on LIDC-IDRI. So our LIDC case **may already have reference airway
or vessel labels**, which would be a free check. It **may also have been in `lung_vessels` training**, so
results on it could look better than on a new patient. Check the series UID against the AirRC and ATM'22 case lists.

## 8. What this means for Pathfinder

Everything in this section is a **modelling choice** derived from the numbers above. None of it is a validated clinical threshold.

1. **Inferred fissures are the weakest layer.** Lobe-surface rHd95 for TotalSegmentator is about 5 mm (median) in
   easy external cases and about 10 mm in hard ones. In easy cases about 12% of the lobe surface is still >2 mm off (NSD 0.88).
   Fissure-specific error is probably worse than this whole-surface figure, because costal surfaces are easy.
   - Treat each inferred fissure as a band: **±5 mm** for the major fissures, **±10 mm** for the right minor fissure
     and wherever no fissure line is visible on the CT. A path entering the band is flagged as a "possible fissure
     crossing" (OR ~3.75–4.12 for pneumothorax, see `risk-evidence.md`), not counted as a certain one.
   - 17–87% of scans have an incomplete fissure, so a predicted lobe boundary can run through fused parenchyma
     with no pleura. The crossing count is an upper bound and the UI should say so.
2. **Vessels:** hard-avoid the vessel mask dilated by **2 mm** (about 3 native voxels), with a soft cost out to **5 mm**.
   The 0.06 mm phantom sizing error is a best case. Vessels under ~1–2 mm are not reliably represented.
   The UI should say "no large vessel detected on path", never "vessel-free path".
3. **Near the nodule, distrust the vessel map.** Vessel-vs-nodule discrimination had a median Az of 0.461 in VESSEL12,
   which is near chance. Require radiologist review of the last ~10 mm before the target.
4. **Artery/vein labels are display-only.** Expect about 10% mislabelling (accuracy 89–90% on CARVE14, Dice ~0.79–0.82
   externally). Apply the same margin to both labels.
5. **Airways:** a **2 mm** margin around lumen plus wall (wall Dice only 0.866). Assume branches past roughly the
   5th–6th generation, and anything under 2 mm, may be missing.
6. **Ribs:** a **3 mm** margin, with extra caution at the costovertebral and costochondral ends, where the developers
   say v2 is incomplete. Confirm the intercostal window on the raw slices.
7. **Hard stops:** turn off lobe and fissure logic after lobectomy or lobar collapse (TotalSegmentator hallucinated
   the missing lobe 35/35 times). Subtract `pleural_pericard_effusion` from the lobes when there is an effusion.
8. **Resolution:** the paper's `total` model is a "1.5-mm model", while our scan is 0.7 × 0.7 × 0.625 mm.
   Boundaries are therefore quantised about 2× coarser than the native image; this is folded into the margins above.
9. **Validation we can actually run:** (a) submit lobe output to LOLA11; (b) score vessels on VESSEL12 and A/V on CARVE14;
   (c) score airways on ATM'22; (d) for our case, have a radiologist click ~20 points on visible fissures and measure
   the point-to-boundary distance. That would replace the ±5/±10 mm guesses with our own number.
