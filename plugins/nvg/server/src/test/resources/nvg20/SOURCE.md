# The TIDE NVG 2.0 schemas (test resources only)

Copied unchanged for the plugin's tests (ADR-0055 point 8; owner, Q6). **Dev-only: never shipped**, never on the plugin's class path at runtime. The tests validate every document the plugin writes against them, with the JDK's `javax.xml.validation`.

| Here | From |
|---|---|
| `nato/common/nvg20/` (`nvg.2.0.xsd`, `nvg.data.2.0.xsd`, `nvg.types.2.0.xsd`, `nvg.filter.2.0.xsd`, `nvg.capabilities.2.0.xsd`, `nvg2012.wsdl`, `common-ws.nvg20.wsdl`) | `src/main/resources/nato/common/nvg20/` |
| `nato/common/stanag4774/confidentialitymetadatalabel.xsd` | `src/main/resources/nato/common/stanag4774/` |
| `nato/common/stanag4778/bindinginformation.xsd` | `src/main/resources/nato/common/stanag4778/` |

- **Repository:** NCI-Agency ANET, `https://github.com/NCI-Agency/anet`
- **Commit:** `fcaeb13c684cb23bbe4214fa9be1117ea3b33600` (tag `3.9.0`, the version the ESA runs, `external/anet/README.md`)
- **Fetched:** 2026-11-12, by PCA-nvg
- **Licence:** the repository's MIT licence (`LICENSE.md`): Copyright (c) 2017-2019 NATO Communication and Information Agency (NCIA); Copyright (c) 2016-2017 U.S. Federal Government (in countries where recognized). The schemas themselves were written by NC3A and NCIA (their headers).

**Not copied:** ANET's `src/main/resources/w3/xmldsig-core-schema.xsd` and `xmlmime.xsd`, which 4778's schema imports. They are under the W3C Software License, which is not on the project's licence list (`CLAUDE.md` section 4). `w3/` holds two stubs written by PCA-nvg instead, with only the names 4778's schema refers to.

The MIT licence text:

```
Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```
