// Reads the text of the Settings entries and of the Monitor from a running emcc (read only), as
// JSON on standard output. A helper for writing the Settings and Monitor chapters; it changes nothing.
//   node scrape.mjs [base-url] > settings.json
import { chromium } from "playwright-core";
const BASE = process.argv[2] ?? "http://127.0.0.1:18098";
const b = await chromium.launch();
const p = await (await b.newContext({ viewport: { width: 1336, height: 849 }, colorScheme: "light" })).newPage();
await p.goto(BASE);
await p.waitForTimeout(3000);
await p.getByRole("tab", { name: "Settings" }).click();
await p.waitForTimeout(800);
const out = {};
const entries = await p.locator(".settings-list-entry").allInnerTexts();
out._entries = entries;
for (let i = 0; i < entries.length; i++) {
  await p.locator(".settings-list-entry").nth(i).click();
  await p.waitForTimeout(900);
  out[entries[i]] = await p.evaluate(() => {
    const area = document.querySelector("#settings-entry") || document.querySelector(".settings-layout");
    const controls = [...area.querySelectorAll("input, select, textarea, button")].filter((e) => e.offsetParent).map((e) => {
      const label = (e.labels && e.labels[0] && e.labels[0].innerText) || e.getAttribute("aria-label") || e.title || "";
      const o = { tag: e.tagName.toLowerCase(), type: e.type || "", label: label.replace(/\n+/g, " "), value: e.type === "checkbox" ? e.checked : e.value || e.textContent.trim().slice(0, 40) };
      if (e.tagName === "SELECT") o.options = [...e.options].map((x) => x.text);
      return o;
    });
    return { text: area.innerText.replace(/\n{2,}/g, "\n").slice(0, 5000), controls: controls.slice(0, 60) };
  });
}
await p.getByRole("tab", { name: "Monitor" }).click();
await p.waitForTimeout(3500);
out._monitor = await p.evaluate(() => {
  const h = [...document.querySelectorAll("h1,h2")].find((x) => x.textContent.trim() === "Monitor");
  let t = h;
  while (t && t.innerText.length < 600) t = t.parentElement;
  return (t || document.body).innerText.replace(/\n{2,}/g, "\n").slice(0, 9000);
});
console.log(JSON.stringify(out, null, 1));
await b.close();
