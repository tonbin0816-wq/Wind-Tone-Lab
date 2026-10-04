import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

// 【殻 S1】字の同梱と、試作の置き場(殻の仕様 §3.8)。
// 殻(capacitor://localhost)はオフラインでも開くので、音名の書体を Google Fonts から取らずにバンドルへ入れる。
// Web 版も同じ index.html / main.jsx を使うので、同じ形になる(見た目は同じ。取得元だけが自分のオリジンへ)。
const path = (p) => fileURLToPath(new URL(p, import.meta.url));
const read = (p) => readFileSync(path(p), "utf8");
const INDEX_HTML = read("../index.html");
const MAIN = read("./main.jsx");

describe("字(Instrument Serif)の同梱", () => {
  it("index.html は Google Fonts に繋がない(fonts.googleapis / fonts.gstatic が無い)", () => {
    expect(INDEX_HTML).not.toContain("fonts.googleapis");
    expect(INDEX_HTML).not.toContain("fonts.gstatic");
  });

  it("main.jsx が @fontsource の 400 と 400-italic を import している", () => {
    expect(MAIN).toContain("import '@fontsource/instrument-serif/400.css'");
    expect(MAIN).toContain("import '@fontsource/instrument-serif/400-italic.css'");
  });

  // index.css の --font-serif より前に @font-face が並ぶ順(以前の <link> が index.css より前にあったのと同じ順)。
  it("字の import は index.css の import より前・最初の描画より前", () => {
    const a = MAIN.indexOf("import '@fontsource/instrument-serif/400.css'");
    const b = MAIN.indexOf("import '@fontsource/instrument-serif/400-italic.css'");
    const css = MAIN.indexOf("import './index.css'");
    expect(css).toBeGreaterThan(-1);
    expect(a).toBeGreaterThan(-1);
    expect(b).toBeGreaterThan(-1);
    expect(a).toBeLessThan(css);
    expect(b).toBeLessThan(css);
    expect(css).toBeLessThan(MAIN.indexOf("root.render("));
  });

  it("import している CSS は入っている版に実在し、同じ書体名で 400 の normal / italic を宣言している", () => {
    const n = read("../node_modules/@fontsource/instrument-serif/400.css");
    const i = read("../node_modules/@fontsource/instrument-serif/400-italic.css");
    expect(n).toMatch(/font-family:\s*'Instrument Serif'/);
    expect(n).toMatch(/font-style:\s*normal/);
    expect(i).toMatch(/font-family:\s*'Instrument Serif'/);
    expect(i).toMatch(/font-style:\s*italic/);
    // index.css の --font-serif が呼ぶ名前と同じであること(名前が違うと黙ってセリフの既定へ落ちる)
    const indexCss = read("./index.css");
    expect(indexCss).toMatch(/--font-serif:\s*"Instrument Serif",\s*serif;/);
  });

  it("THIRD_PARTY_NOTICES.md に Instrument Serif の OFL の節がある", () => {
    const notices = read("../THIRD_PARTY_NOTICES.md");
    expect(notices).toContain("Instrument Serif(@fontsource/instrument-serif 5.3.0)— SIL Open Font License 1.1");
    expect(notices).toContain("SIL OPEN FONT LICENSE Version 1.1");
  });
});

describe("試作 ring-proto.html の置き場", () => {
  it("public/ には無い(dist に試作が入らない)", () => {
    expect(existsSync(path("../public/ring-proto.html"))).toBe(false);
  });
  it("design/ に移っている", () => {
    expect(existsSync(path("../design/ring-proto.html"))).toBe(true);
  });
});
