// @vitest-environment jsdom
import React, { act, useState } from "react";
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
//   ・部品 DeviceTransferSheet は残してあり、単独で描けば今までの中身(DeviceTransferPanel)を出し、閉じられる
//   ・マイページの入口「アカウント引継」は残り、押すと開く口(onOpenBackup)を呼ぶ
// 【守っていないもの】書き出し・読み戻しそのもの(backup/ 側の検査と実機)。
// ------------------------------------------------------------------
const { JoinIntro, ProfileView, DeviceTransferSheet } = await import("./CommunityTab.jsx");

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

  it("部品 DeviceTransferSheet は残してあり、単独で描くと参加の場面に絞った中身(記録の保存ではない)を出し、閉じられる", async () => {
    function Probe() {
      const [open, setOpen] = useState(true);
      return open ? <DeviceTransferSheet onClose={() => setOpen(false)} /> : <div data-closed="" />;
    }
    await act(async () => { root.render(<Probe />); });
    const dialog = backupDialog();
    expect(dialog).not.toBe(null);
    expect(dialog.textContent).not.toContain("記録の保存");
    expect(buttonNamed("ファイルから読み戻す")).toHaveLength(1);
    expect(buttonNamed("この端末の記録を書き出す")).toHaveLength(1);
    expect(buttonNamed("ファイルに書き出す")).toHaveLength(0);
    await act(async () => { document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); });
    // BottomSheet は閉じる動きのあとで外れる。外れるまで待つ
    for (let i = 0; i < 20 && backupDialog(); i++) {
      await act(async () => { await new Promise((r) => setTimeout(r, 50)); });
    }
    expect(backupDialog()).toBe(null);
    expect(document.querySelector("[data-closed]")).not.toBe(null);
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
