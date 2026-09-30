// ------------------------------------------------------------------
// 【便BE 2026-09-30】ブロックの結合の検査(blockJoined / blockRestore*.test.jsx)が共有する道具。
// **本番のコードからは import しないこと**(名前が .test で終わらないので収集はされない)。
//
// サーバーの代わり: 公開ユーザー4人(+自分)と、その4人の目安。形は人ごとに違う
// (みんなの平均が「人を落とすと実際に動く」ように。cohortMine.test.jsx と同じ考え)。
// みんなの平均は3人未満だと出ない(align.js の MIN_COHORT)ので、1人ブロックしても出る4人にしてある。
// ------------------------------------------------------------------
import React, { act } from "react";
import { createRoot } from "react-dom/client";

const KEYS = [14, 16, 18, 20, 22];
const SHAPES = [
  { c: [1450, 1530, 1490, 1600, 1560], h: [17, 19.5, 18, 21, 20] },
  { c: [1380, 1400, 1470, 1440, 1520], h: [15, 16, 18.5, 17, 19] },
  { c: [1500, 1610, 1580, 1650, 1700], h: [18, 17, 20, 22.5, 21] },
  { c: [1420, 1480, 1550, 1500, 1580], h: [16, 18, 17.5, 19, 20.5] },
];
export const NICK = { u1: "しろねこ", u2: "くろねこ", u3: "みけねこ", u4: "とらねこ" };
export const SERVER_USERS = Object.entries(NICK).map(([uid, nickname], i) => ({
  uid, nickname, icon: "ic-cat", iconColor: i + 1, photo: null, isPublic: true,
  saxTypes: ["alto"], gear: { alto: { instrumentBrand: "YAMAHA", instrumentModel: `M${i}` } },
  position: "学生", genres: ["クラシック"], ensembles: [],
  stats: { daysAll: 10 + i, secAll: 3600 + i },
}));
export const SERVER_IDEALS = Object.keys(NICK).map((uid, i) => ({
  id: `${uid}_alto`, ownerUid: uid, saxType: "alto", sourceSessionCount: 3,
  notes: Object.fromEntries(KEYS.map((k, j) => [k, {
    spectralCentroidHz: SHAPES[i].c[j], hnrDb: SHAPES[i].h[j], pitchCentsSigned: 4 - j * 3,
  }])),
}));
export const MY_PROFILE = {
  nickname: "じぶん", icon: "ic-dog", iconColor: 5, saxTypes: ["alto"], gear: { alto: {} },
  position: "社会人", startYear: 2015, genres: ["ジャズ"], ensembles: ["ソロ"], isPublic: true,
};

let root = null; let host = null; let realRect = null;
export function setupDom() {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  window.scrollTo = () => {};
  if (!window.SVGElement.prototype.getComputedTextLength) {
    window.SVGElement.prototype.getComputedTextLength = function () { return (this.textContent || "").length * 7; };
  }
  realRect = window.Element.prototype.getBoundingClientRect;
  window.Element.prototype.getBoundingClientRect = () => ({ width: 360, height: 0, top: 0, left: 0, right: 360, bottom: 0, x: 0, y: 0 });
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
}
export function teardownDom() {
  act(() => root.unmount());
  host.remove();
  document.body.innerHTML = "";
  window.Element.prototype.getBoundingClientRect = realRect;
}
// 【便BE 統括指示「揺れる検査は、固定の待ちではなく状態がそろうまで待つ形に」】
// 以前は「setTimeout(0) を12回」の固定の待ちだった。重い並走のもとでは足りず(5 秒の上限にも当たった)、
// 軽いときは余計に回る。**確かめたい状態になるまで**短い間隔で回し、期限(既定 10 秒)を過ぎたら名前付きで落とす。
const WAIT_DEADLINE_MS = 10000;
const tick = () => act(async () => { await new Promise((r) => setTimeout(r, 5)); });
export async function waitFor(pred, label = "条件", deadlineMs = WAIT_DEADLINE_MS) {
  const end = Date.now() + deadlineMs;
  while (!pred()) {
    if (Date.now() > end) throw new Error(`待っても揃わなかった: ${label}`);
    await tick();
  }
}
// 非同期に読む値(IndexedDB の中身など)が条件を満たすまで待ち、その値を返す。
export async function waitForValue(read, pred, label = "値", deadlineMs = WAIT_DEADLINE_MS) {
  const end = Date.now() + deadlineMs;
  for (;;) {
    const v = await read();
    if (pred(v)) return v;
    if (Date.now() > end) throw new Error(`待っても揃わなかった: ${label}(最後の値 ${JSON.stringify(v)})`);
    await tick();
  }
}
// 名簿と目安の読み込みが済み、順位の行が描かれるまで(既定)。
const namesReady = () => bodyText().includes("目安を公開している") && Boolean(document.querySelector('[role="button"]'));
// 【起動の手順は main.jsx と同じ】本物のアプリは**描く前に**保存の読み込みを温める(warmPersistedStateCache)。
// 温めずに描くと、usePersistedState は IndexedDB を読み終えるまで書き込みを止めるので、
// その数ミリ秒のうちに押したブロックが保存されない(温めが済んだ起動では起きない。温めが 1500ms の上限に
// 当たった起動では、usePersistedState の既知の性質(便AL)で本物でも起こりうる。検査が起動の手順を省いていた)。
// warm = App.jsx の warmPersistedStateCache を渡す。
export async function drawJoined(JoinedView, props = {}, ready = namesReady, warm = null) {
  if (warm) await warm();
  await act(async () => {
    root.render(
      <JoinedView profile={MY_PROFILE} uid="me" sessions={[]} tuningHz={442} onAdoptIdeal={() => ({})}
                  onEdit={() => {}} onTogglePublic={async () => {}} onChangeAvatar={async () => {}}
                  onPhotoChanged={() => {}} onDelete={async () => {}} initialTab="rank" {...props} />,
    );
  });
  await waitFor(ready, "名簿と目安の読み込み");
}
export const bodyText = () => document.body.textContent;
export const buttonsNamed = (name) => [...document.querySelectorAll("button")].filter((b) => b.textContent.trim() === name);
export const dialogNamed = (label) => document.querySelector(`[role="dialog"][aria-label="${label}"]`);
// 順位の行(role="button")のうち、その人のもの
export const rankRowOf = (nick) => [...document.querySelectorAll('[role="button"]')].find((el) => el.textContent.includes(nick));
export const blockedRow = () => [...document.querySelectorAll("button")].find((b) => b.textContent.startsWith("ブロック中の人"));
// 押したあとの描き直しは act が済ませる(押して開く・閉じるはどれも同期の state 変更)。
export async function click(el) { await act(async () => { el.click(); }); }
export async function goSubTab(label) {
  const t = [...document.querySelectorAll("button, [role='tab']")].find((b) => b.textContent.trim() === label);
  await click(t);
}
