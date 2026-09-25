// @vitest-environment jsdom
import React, { act } from "react";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createRoot } from "react-dom/client";

// ------------------------------------------------------------------
// 【便BB 2026-09-25 統括指示】コミュニティに参加していない人も「アカウント引継」を開ける。
// 以前はマイページ(参加済み)からしか BackupPanel へ行けず、参加していない人は
// 計測データを書き出す手段が無かった。参加前の画面(JoinIntro)を実際に描いて押す。
//   ・入口がある(名前はマイページと同じ「アカウント引継」)
//   ・体裁はマイページの同じ入口と同じ(style の綴りが一致)
//   ・押すと同じシート(BottomSheet「アカウント引継」の中に BackupPanel)が開き、閉じられる
// 【守っていないもの】書き出し・読み戻しそのもの(backup/ 側の検査と実機)。ここは入口と配線だけ。
// ------------------------------------------------------------------
const { JoinIntro, ProfileView } = await import("./CommunityTab.jsx");

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
const backupDialog = () => document.querySelector('[role="dialog"][aria-label="アカウント引継"]');

describe("参加前の画面からアカウント引継を開ける(便BB)", () => {
  it("入口が1つあり、押すとマイページと同じシート(中身は記録の保存)が開く", async () => {
    await act(async () => { root.render(<JoinIntro onJoin={async () => {}} />); });
    const entry = buttonNamed("アカウント引継");
    expect(entry).toHaveLength(1);
    expect(backupDialog()).toBe(null);
    await act(async () => { entry[0].click(); });
    const dialog = backupDialog();
    expect(dialog).not.toBe(null);
    // 中身は BackupPanel そのもの(書き出し・読み戻しのボタン)
    expect(dialog.textContent).toContain("記録の保存");
    expect(buttonNamed("ファイルに書き出す")).toHaveLength(1);
    expect(buttonNamed("ファイルから読み戻す")).toHaveLength(1);
  });

  it("シートは閉じられる(閉じると入口の画面に戻る)", async () => {
    await act(async () => { root.render(<JoinIntro onJoin={async () => {}} />); });
    await act(async () => { buttonNamed("アカウント引継")[0].click(); });
    expect(backupDialog()).not.toBe(null);
    await act(async () => { document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); });
    // BottomSheet は閉じる動きのあとで外れる。外れるまで待つ
    for (let i = 0; i < 20 && backupDialog(); i++) {
      await act(async () => { await new Promise((r) => setTimeout(r, 50)); });
    }
    expect(backupDialog()).toBe(null);
    expect(buttonNamed("アカウント引継")).toHaveLength(1);
  });

  it("体裁はマイページの「アカウント引継」と同じ(style の綴りが一致)", async () => {
    await act(async () => { root.render(<JoinIntro onJoin={async () => {}} />); });
    const joinStyle = buttonNamed("アカウント引継")[0].getAttribute("style");
    const joinClass = buttonNamed("アカウント引継")[0].className;
    await act(async () => { root.render(<ProfileView profile={PROFILE} uid="u1" onOpenBackup={() => {}} />); });
    const mine = buttonNamed("アカウント引継");
    expect(mine).toHaveLength(1);
    expect(joinStyle).toBe(mine[0].getAttribute("style"));
    expect(joinClass).toBe(mine[0].className);
  });

  it("参加の一手は今までどおり(入口を足しても「参加してプロフィールを作る」は1つで、押すと onJoin が呼ばれる)", async () => {
    let joined = 0;
    await act(async () => { root.render(<JoinIntro onJoin={async () => { joined += 1; }} />); });
    const join = buttonNamed("参加してプロフィールを作る");
    expect(join).toHaveLength(1);
    await act(async () => { join[0].click(); });
    expect(joined).toBe(1);
    expect(backupDialog()).toBe(null);
  });
});
