# Idea: ACP 127 feasibility, an ACP 127 heading in front of an XML message

- **Status:** Parked (owner, 2026-11-19). Saved for later; no task, no milestone.
- **Author:** ACA. Research done on 2026-11-19, read-only, no spike.
- **Not a decision.** Nothing here is accepted. When the idea is resumed, it becomes ADRs, spikes and tasks through the normal process.
- **Source:** ACP 127(G), *Tape Relay Procedures* (CCEB, November 1988; frozen by the CCEB in 1997, COMAG-127/1), unclassified, from `https://www.navy-radio.com/manuals/acp/acp127g.pdf`. Paragraph numbers below are that edition's. The PDF is not in the repository.

## The question

Can an ACP 127 heading be put in front of an XML message, so that transmission systems act on the heading before the target system gets the data, and the target system then strips the heading and handles the XML?

## Answer

**Yes, as an envelope, but the XML must travel encoded, not raw.**

### Why it fits

- A message has 16 format lines in three parts: heading, text and ending (para 142, Annex B).
  - **Heading:** lines 1 to 10. They hold the transmission identification, the routing indicators, the precedence, the security warning, the transmission instructions, the originator and the addressees.
  - **Text:** line 12, between two lines that hold only `BT`, the separator (lines 11 and 13).
  - **Ending:** line 16 is `NNNN`, the end-of-message marker.
- Relay stations route on lines 1 to 4, and they must send the text exactly as the originator wrote it (para 201.b).
- The target system therefore drops everything up to the first `BT` line and from the last one on, and keeps the payload.

### Why raw XML breaks

1. **Character set.** The code is ITA-2 (para 140): upper case, digits and a little punctuation. It has no `<`, `>`, `=`, `"`, `&` or `;`. Punctuation that cannot be sent may be replaced by abbreviations (para 201.b(2)), which corrupts XML. Many real networks run ACP 127 over ASCII (IA5) under national supplements. That widens the character set, but points 2 to 5 still apply.
2. **Line length.** A line has at most 69 characters (para 138.f) and ends with two carriage returns and one line feed. XML must be wrapped, and a break inside an attribute value or a text node changes the data.
3. **Pages and sections in the text.** Over 20 lines, a message is split into pages of at most 20 lines. Each later page gets a page identification line, and extra line feeds go between the pages (para 208.a to d). A transmission holds at most five pages of text, about 6 to 7 kB. A longer message is split into sections, with "SECTION 1 OF 2" written into the text itself (para 208.e). The receiver must remove these lines and join the parts.
4. **Reserved sequences.** `NNNN` ends a message (para 114). `ZCZC` starts one in automatic switching equipment (para 128). A line that holds only `BT` is the separator. Any of these in the payload can end or split the message.
5. **A classification line first.** The text begins with the classification or `UNCLAS` (Annex B, line 12), so a plain line always comes before the payload.

### The proposed envelope

- **Compress the XML, then encode it as hex** (`0-9 A-F`). Hex is upper case and digits only, so it is valid ITA-2. `N` and `Z` are not hex digits, so `NNNN` and `ZCZC` cannot occur.
  - Base32 is smaller (×1.6 instead of ×2), but it uses N, Z and C, so it needs a guard against the reserved sequences.
  - Base64 uses lower case, `+` and `=`, so it does not pass ITA-2.
- **Wrap the lines** at 64 characters.
- **Add a begin line with the length and a SHA-256, and an end line.** Teleprinter links garble characters (para 141 is a garble table), so the receiver must detect damage.
- **Number the parts** when the payload is larger than one transmission section, so that the receiver can rebuild it.
- **The target system:**
  1. strips the heading and the ending;
  2. drops the classification, page and section lines;
  3. checks the SHA-256;
  4. decodes and decompresses the payload, and handles the XML.

### Caveats

- **National supplements decide the details.** Edition G is frozen, and each nation's supplement sets the character set, the limits and extra rules. Check the supplement of the actual network, above all whether it runs ITA-2 or ASCII.
- **ACP 123 may fit better.** ACP 123 (military X.400) carries binary body parts natively, and the CCEB's freeze note names ACP 123 to ACP 127 interfaces. ACP 127 makes most sense when the path really is telegraph or tape relay.

## In emcc

An ACP 127 envelope would be a codec in a plugin's server part: it wraps on sending and unwraps on receiving, with its own connections (ADR-0036). ECore and the contracts would not change.

## Before resuming

- Get the national supplement of the network in question, and the format of the XML that is to travel.
- A small spike: wrap and unwrap a large XML message, with page and section splitting and a garbled character, and check the round trip.
