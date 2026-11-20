# WinTAK symbol fixtures (T-129, criterion 38): reconstructed, not as recorded

S1 to S5 are the five units the owner sent from WinTAK on 2026-11-05 through the ESA TAK Server. **The raw XML was not kept**: these files are built from the values the PCA-cot handover records (type, `<mil2525c SIDC>`, `<amp>`, `<remarks>`), with the position, the times and the uids made up (test position, latitude differs from longitude). Replace them with a real recording when the owner sends the five again from WinTAK (M5 check).

| File | CoT type | `mil2525c/@SIDC` | Setting |
|---|---|---|---|
| `wintak-S1` | `a-f-G-U-C-I` | `SFGPUCI--------` | baseline infantry |
| `wintak-S2` | `a-f-G-U-C-I-B` | `SFGPUCI----G---` | "battalion" (the code says `G`, regiment) |
| `wintak-S3` | `a-f-G-U-C-I-B` | `SFGPUCI--A-G---` | "HQ" (`A` sits at the 10th character, part of the function) |
| `wintak-S4` | `a-f-G-U-C-I-C` | `SFGPUCI----F---` | amplifiers: `<amp>` and the same as `<remarks>` text |
| `wintak-S5` | `a-f-S-S-C-L` | `SFSSCL---------` | sea surface combatant |
