# ATAK 5.6 symbol fixtures (T-129)

One CoT event per marker, as ATAK-CIV 5.6.0.12 sent them through the ESA TAK Server on 2026-11-09 (the owner made them in ATAK; see `docs/handover/pca-cot.md`). All attributes and all `<detail>` children are as recorded, with two changes: `point/@lat` and `@lon` are test values (latitude differs from longitude), and `<_flow-tags_>` (added by TAK Server, not by ATAK) is removed. Fifteen files, no WinTAK events.

| File | CoT type | `__milsym id` | Setting |
|---|---|---|---|
| `atak-T1` / `T2` / `T3` | `a-f-G` / `a-h-G` / `a-n-G` | `SFG*------*****` / `SHG…` / `SNG…` | friend, hostile, neutral |
| `atak-T4` / `T5` / `T6` / `T7` / `T8` | `a-f-G-U` | `SFG*U-----*A***` / `*D` / `*E` / `*F` / `*H` | team, platoon, company, battalion, brigade |
| `atak-suspect-F.9.120619` | `a-s-G-U` | `SSG*U-----*E***` | suspect (the owner's feint/dummy attempt) |
| `atak-T12` / `T13` | `a-f-G-U` | `SFG*U-----*E***` | `unitmodifier F` = `+` / `-` |
| `atak-T14-equipment` | `a-f-G-E` | `SFG*E-----*****` | `unitmodifier C` = 12 |
| `atak-T14-higher-formation` | `a-f-G-U` | `SFG*U-----*E***` | `M` = "1st BDE", empty `F` |
| `atak-T16` | `a-f-G-U` | `SFG*U-----*E***` | `T` = "A CO" |
| `atak-T18` | `a-f-G-U` | `SFGAU-----*E***` | status planned (4th character `A`) |
