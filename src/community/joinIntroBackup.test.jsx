// @vitest-environment jsdom
import React, { act } from "react";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createRoot } from "react-dom/client";

// ------------------------------------------------------------------
// 【便BB 2026-09-25 統括指示】コミュニティに参加していない人も「アカウント引継」を開ける。
// 以前はマイページ(参加済み)からしか BackupPanel へ行けず、参加していない人は
// 計測データを書き出す手段が無かった。参加前の画面(JoinIntro)を実際に描いて押す。
// 【便BX 2026-10-06 本人の決定 D1】入口の名前は「端末を替えるとき」になり、開くのは参加の場面に絞ったシート(DeviceTransferPanel)。
//   マイページの入口は「アカウント引継」(BackupSheet = 記録の保存)のまま。名前で2つを分ける。
// 【便CD 2026-10-08 本人「それ以下の利用規約やボタン自体もいらない」「参加しないという選択肢ないです / デフォでは参加して、
//   非公開の選択肢はプロフィールであるという構図」】参加のカードの入口「端末を替えるとき」は外した(全員が参加し、書き出しは
//   参加後のマイページの「アカウント引継」から)。ここでは:
//   ・参加のカードに入口が無い(「端末を替えるとき」も「アカウント引継」も)
//   ・【便CE 2026-10-08】部品 DeviceTransferSheet / DeviceTransferPanel は消した(CommunityTab から export されない)
//   ・マイページの入口「アカウント引継」は残り、押すと開く口(onOpenBackup)を呼ぶ
// 【守っていないもの】書き出し・読み戻しそのもの(backup/ 側の検査と実機)。
// ------------------------------------------------------------------
const Community = await import("./CommunityTab.jsx");
const { JoinIntro, ProfileView } = Community;

const PROFILE = {
  nickname: "てすと", icon: "ic-cat", iconColor: 2,
  saxTypes: ["alto"], gear: { alto: {} }, position: "社会人", startYear: 2015,
  genres: ["ジャズ"], ensembles: ["ソロ"], isPublic: true,
};

let root; let host;
beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  window.scrollTo = () => {}; // jsdom に無い(シートを開くときに呼ばれる)
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  document.body.innerHTML = "";
});

const buttonNamed = (name) => [...document.querySelectorAll("button")].filter((b) => b.textContent.trim() === name);
const backupDialog = () => document.querySelector('[role="dialog"][aria-label="端末を替えるとき"]');

describe("参加前の画面と記録の移し方(便BB → 便CD)", () => {
  it("【便CD】参加のカードに記録の移し方の入口は無い(「端末を替えるとき」も「アカウント引継」も)。カードを押してもシートは開かない", async () => {
    await act(async () => { root.render(<JoinIntro onJoin={async () => {}} />); });
    expect(buttonNamed("端末を替えるとき")).toHaveLength(0);
    expect(buttonNamed("アカウント引継")).toHaveLength(0);
    expect(document.body.textContent).not.toContain("端末を替えるとき");
    await act(async () => { document.querySelector("[data-join-card]").click(); });
    expect(backupDialog()).toBe(null);
  });

  it("【便CE】部品 DeviceTransferSheet・細い導線の体裁 JOIN_QUIET_LINK_STYLE は消した(CommunityTab から出ていない)", () => {
    expect(Community.DeviceTransferSheet).toBeUndefined();
    expect(Community.JOIN_QUIET_LINK_STYLE).toBeUndefined();
    expect(typeof Community.BackupSheet).toBe("function");   // マイページの「アカウント引継」のシートは残る
  });

  it("マイページの入口「アカウント引継」は残り、押すと開く口(onOpenBackup)を呼ぶ", async () => {
    let opened = 0;
    await act(async () => { root.render(<ProfileView profile={PROFILE} uid="u1" onOpenBackup={() => { opened += 1; }} />); });
    const mine = buttonNamed("アカウント引継");
    expect(mine).toHaveLength(1);
    await act(async () => { mine[0].click(); });
    expect(opened).toBe(1);
  });

  it("参加の一手は今までどおり(カードを押すと onJoin が1回呼ばれる)", async () => {
    let joined = 0;
    await act(async () => { root.render(<JoinIntro onJoin={async () => { joined += 1; }} />); });
    expect(document.querySelector('input[type="checkbox"]')).toBe(null);
    await act(async () => { document.querySelector("[data-join-card]").click(); });
    expect(joined).toBe(1);
    expect(backupDialog()).toBe(null);
  });
});
