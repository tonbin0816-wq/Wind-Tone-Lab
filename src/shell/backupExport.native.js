// 【殻 S2】記録の書き出し。WKWebView は <a download> で何も起きないので、ファイルに書いて共有シートへ渡す(殻の仕様 §4.1)。
// BackupPanel.jsx の殻の枝からだけ動的 import で読む。
import { Filesystem, Directory, Encoding } from "@capacitor/filesystem";
import { Share } from "@capacitor/share";

// 一時ファイルは Cache に書き、共有が終わったら消す(端末に写しを残さない。保存先は利用者が共有シートで選ぶ)。
export async function exportSnapshotFile({ name, json }) {
  const { uri } = await Filesystem.writeFile({ path: name, data: json, directory: Directory.Cache, encoding: Encoding.UTF8 });
  try {
    await Share.share({ title: name, url: uri, dialogTitle: "書き出し先を選ぶ" });
    return { shared: true };
  } catch (e) {
    if (/cancel/i.test(String(e?.message ?? e))) return { cancelled: true };   // iOS は "Share canceled" で reject する
    throw e;
  } finally {
    try { await Filesystem.deleteFile({ path: name, directory: Directory.Cache }); } catch { /* 消せなくても害は無い(Cache) */ }
  }
}
