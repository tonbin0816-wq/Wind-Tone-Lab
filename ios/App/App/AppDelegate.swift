import UIKit
import Capacitor

@UIApplicationMain
class AppDelegate: UIResponder, UIApplicationDelegate {

    var window: UIWindow?

    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
        // Override point for customization after application launch.
        return true
    }

    func applicationWillResignActive(_ application: UIApplication) {
        // Sent when the application is about to move from active to inactive state. This can occur for certain types of temporary interruptions (such as an incoming phone call or SMS message) or when the user quits the application and it begins the transition to the background state.
        // Use this method to pause ongoing tasks, disable timers, and invalidate graphics rendering callbacks. Games should use this method to pause the game.
    }

    func applicationDidEnterBackground(_ application: UIApplication) {
        // Use this method to release shared resources, save user data, invalidate timers, and store enough application state information to restore your application to its current state in case it is terminated later.
        // If your application supports background execution, this method is called instead of applicationWillTerminate: when the user quits.
    }

    func applicationWillEnterForeground(_ application: UIApplication) {
        // Called as part of the transition from the background to the active state; here you can undo many of the changes made on entering the background.
    }

    func applicationDidBecomeActive(_ application: UIApplication) {
        // Restart any tasks that were paused (or not yet started) while the application was inactive. If the application was previously in the background, optionally refresh the user interface.
    }

    func applicationWillTerminate(_ application: UIApplication) {
        // Called when the application is about to terminate. Save data if appropriate. See also applicationDidEnterBackground:.
    }

    func application(_ application: UIApplication,
                     configurationForConnecting connectingSceneSession: UISceneSession,
                     options: UIScene.ConnectionOptions) -> UISceneConfiguration {
        let config = UISceneConfiguration(name: "Default Configuration",
                                          sessionRole: connectingSceneSession.role)
        config.delegateClass = SceneDelegate.self
        return config
    }
}

// ============================================================
// 【殻 S1/S2】Ficus のネイティブ側。新しい .swift を足さずここに置く(ソースのために project.pbxproj を触らないため。
// pbxproj は S2 で PrivacyInfo.xcprivacy を Resources に入れるためだけに触っている)。
// ============================================================
import WebKit
import AVFoundation

// S1: 自前の ViewController。根は SceneDelegate.swift が作る(window?.rootViewController = FicusViewController())。
// Main.storyboard の customClass は同じクラスに揃えてあるだけ(Capacitor 8.5.2 のテンプレートは UIScene の作法で、storyboard だけでは根にならない)。
class FicusViewController: CAPBridgeViewController {
    // 作者の maximum-scale を「指2本の拡大」だけ無視する = Safari と同じ規則。入力欄の自動拡大は止まったまま(§3.5)。
    override open func webViewConfiguration(for instanceConfiguration: InstanceConfiguration) -> WKWebViewConfiguration {
        let configuration = super.webViewConfiguration(for: instanceConfiguration)
        configuration.ignoresViewportScaleLimits = true
        return configuration
    }
    override open func capacitorDidLoad() {
        bridge?.registerPluginInstance(FicusAudioSessionPlugin())
    }
}

// S2: 音の出口。マイクを開いている間、iOS は出力を受話口へ回す。playAndRecord + defaultToSpeaker で本体のスピーカーへ。
// 【本人裁定 2026-10-05】Bluetooth のイヤホンへは出す(allowBluetoothA2DP = 出力だけ Bluetooth。マイクは本体のまま)。
// HFP(.allowBluetoothHFP / 旧名 .allowBluetooth)は付けない ── マイクが Bluetooth 側へ替わり、音が電話の品質に落ちるため。
// 有線・Bluetooth のイヤホンがつながっていればそちらへ、無ければスピーカーへ。受話口には出さない。
// 【便CS】選択肢から HFP を外しても、WebKit がマイクを取るときに AllowBluetooth を付け直し、既定の機器(= イヤホンのマイク)で取る。
// そこで入力は setPreferredInput で本体のマイクに固定する(applyInputRule)。有線のヘッドセットのマイクも使わない。
// イヤホンをつなぐ・外す(経路の変化)たびに同じ規則を当て直す。外したとき(OldDeviceUnavailable)は WebKit が
// AudioContext を一度止めるので、メトロノームは JS 側(App.jsx の onstatechange)で再開する(実機で確かめる)。
@objc(FicusAudioSessionPlugin)
public class FicusAudioSessionPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "FicusAudioSessionPlugin"
    public let jsName = "FicusAudioSession"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "routeToSpeaker", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "sessionInfo", returnType: CAPPluginReturnPromise)
    ]

    // 殻の音のセッションの選択肢(値の唯一の答え)。
    static let sessionOptions: AVAudioSession.CategoryOptions = [.defaultToSpeaker, .allowBluetoothA2DP]

    // 【便CS】入力の規則で setPreferredInput を一度呼んだ経路(routeSignature)。同じ経路ではもう呼ばない ──
    // 1回の取り込みの間は、WebKit や iOS と往復しても、呼ぶ回数は経路の種類の数までで止まる(時間の値は使わない)。
    // 入力が本体のマイクになったら・取り込みが終わったら(playAndRecord でなくなったら)空にするので、**取り込みを始めるたびに1周し直す**
    // (WebKit は既定の機器で取り込みを始めるたびに setPreferredInput(nil) を呼ぶ。CoreAudioCaptureUnit.cpp の captureDeviceChanged)。
    // routeToSpeaker は Capacitor の部品の列、経路の変化は main で走るので、鍵で守る。
    private var inputRuleTriedRoutes = Set<String>()
    private let inputRuleLock = NSLock()

    @objc override public func load() {
        NotificationCenter.default.addObserver(self,
                                               selector: #selector(handleRouteChange(_:)),
                                               name: AVAudioSession.routeChangeNotification,
                                               object: nil)
    }

    deinit {
        NotificationCenter.default.removeObserver(self)
    }

    @objc func routeToSpeaker(_ call: CAPPluginCall) {
        let session = AVAudioSession.sharedInstance()
        do {
            // 種別・モード・選択肢が既に同じなら立て直さない(取り込み中・再生中の経路を無駄に揺らさない)
            if needsSessionReset(session) {
                try session.setCategory(.playAndRecord, mode: .default, options: FicusAudioSessionPlugin.sessionOptions)
            }
            applyInputRule(session)
            try applyOutputRule(session)
            call.resolve([
                "category": session.category.rawValue,
                "outputs": session.currentRoute.outputs.map { $0.portType.rawValue }
            ])
        } catch {
            call.reject("audio session: \(error.localizedDescription)")
        }
    }

    // 【便CQ】診断の板の読み出し口。音のセッションを読むだけで、何も変えない。
    // options と routeSharingPolicy は生の値(整数)で返し、名前への読み替えは JS(src/audioDiag.jsx)が持つ。
    @objc func sessionInfo(_ call: CAPPluginCall) {
        let session = AVAudioSession.sharedInstance()
        // 【便CS】入力の候補と優先の入力(優先が無い = nil のときは空の辞書。板は none と出す)
        let availableInputs: [[String: String]] = (session.availableInputs ?? []).map { FicusAudioSessionPlugin.portInfo($0) }
        var preferredInput: [String: String] = [:]
        if let port = session.preferredInput { preferredInput = FicusAudioSessionPlugin.portInfo(port) }
        call.resolve([
            "category": session.category.rawValue,
            "mode": session.mode.rawValue,
            "options": Int(session.categoryOptions.rawValue),
            "routeSharingPolicy": Int(session.routeSharingPolicy.rawValue),
            "outputs": session.currentRoute.outputs.map { $0.portType.rawValue },
            "inputs": session.currentRoute.inputs.map { $0.portType.rawValue },
            "outputVolume": Double(session.outputVolume),
            "otherAudioPlaying": session.isOtherAudioPlaying,
            "availableInputs": availableInputs,
            "preferredInput": preferredInput
        ])
    }

    // 【便CS】port の portType(生の値)と名前。診断の板と、JS の内蔵マイクの見分け(src/builtInMic.js)が読む。
    static func portInfo(_ port: AVAudioSessionPortDescription) -> [String: String] {
        return ["portType": port.portType.rawValue, "name": port.portName]
    }

    // 経路の変化(イヤホンの抜き差し・Bluetooth の接続と切断・WebKit による種別の立て直し)。
    // 通知は裏のスレッドで来るので main へ回す。当て直すのは「取り込み中(playAndRecord)」のときだけで、
    // WebKit が再生だけの種別(playback など。受話口へは回らない)にしている間は触らない。
    @objc func handleRouteChange(_ notification: Notification) {
        DispatchQueue.main.async {
            let session = AVAudioSession.sharedInstance()
            guard session.category == .playAndRecord else { self.clearInputRuleTriedRoutes(); return }
            do {
                if self.needsSessionReset(session) {
                    try session.setCategory(.playAndRecord, mode: .default, options: FicusAudioSessionPlugin.sessionOptions)
                }
                self.applyInputRule(session)
                try self.applyOutputRule(session)
            } catch {
                CAPLog.print("FicusAudioSession: route change: \(error.localizedDescription)")
            }
        }
    }

    // 【便CQ】立て直すかの判断。種別・選択肢に加えてモードも見る ── **念のための条件**(いまの判定は1件も変えない)。
    // WebKit が取り込み中に立て直すときの選択肢は AllowBluetooth|A2DP|AirPlay(|DefaultToSpeaker)で、ここの sessionOptions とは
    // 一致しないので、WebKit が videoChat に立て直した場合は選択肢の違いだけで既に真になる(便CQ の審査の指摘)。
    // モードの条件が効くのは「選択肢は同じでモードだけ違う」場合だけで、いまそれを起こす経路は知られていない。
    // マイクが入っているとメトロノームが小さい原因は**仮説**(WebKit が videoChat = 通話の音量にする。WebKit bug 271305)で、
    // 旧来の処理(選択肢が違えば .default へ戻す)で直らなかった理由は未解明。WebKit は routeSharingPolicy も比べるので、
    // こちらが setCategory すると WebKit がまた立て直しうる。切り分けは診断の板(sessionInfo)で実機の値を見て行う。
    // モードは .default(殻の仕様 §4.4。setCategory の2か所と同じ値)。
    func needsSessionReset(_ session: AVAudioSession) -> Bool {
        return session.category != .playAndRecord
            || session.mode != .default
            || session.categoryOptions != FicusAudioSessionPlugin.sessionOptions
    }

    // 【便CS】入力の規則: 入力はいつも本体のマイク(builtInMic)。Bluetooth のイヤホン(HFP)・有線のヘッドセットのマイクは使わない
    // (計測の質のため。本人の実機の板で in = BluetoothHFP のとき out も BluetoothHFP・outputVolume 0.15 = 通話の経路に引きずられていた)。
    // WebKit はマイクを取るとき setCategory に AllowBluetooth(HFP)を付け、既定の機器で取ると setPreferredInput(nil) にする
    // (AVAudioSessionCaptureDeviceManager.mm / CoreAudioCaptureUnit.cpp の captureDeviceChanged)ので、イヤホンのマイクが入力になりうる。
    // ここで本体のマイクを優先の入力にする。入力が本体のマイクなら、出力は A2DP(イヤホン)かスピーカーへ行く見込み(実機待ち)。
    // 呼ぶのは routeToSpeaker と経路の変化。入力も優先も本体のマイクなら何もしない。同じ経路では1回しか呼ばない(上の inputRuleTriedRoutes)。
    // 本体のマイクが一覧に無い(取り込み中でない等)ときも何もしない。失敗は記録だけ(出口の規則は続けて当てる)。
    func applyInputRule(_ session: AVAudioSession) {
        guard let builtIn = (session.availableInputs ?? []).first(where: { $0.portType == .builtInMic }) else { return }
        let inputIsBuiltIn = session.currentRoute.inputs.first?.portType == .builtInMic
        let preferredIsBuiltIn = session.preferredInput?.portType == .builtInMic
        if inputIsBuiltIn && preferredIsBuiltIn {
            clearInputRuleTriedRoutes()
            return
        }
        guard markRouteTried(routeSignature(session)) else { return }
        do {
            try session.setPreferredInput(builtIn)
        } catch {
            CAPLog.print("FicusAudioSession: preferred input: \(error.localizedDescription)")
        }
    }

    // 試した経路の集合に足す。初めての経路なら true。判定と挿入は鍵の中で1つの式(Set.insert の inserted)。
    // 鍵は setPreferredInput の前に外す(鍵を持ったまま音のセッションを呼ばない)。
    func markRouteTried(_ route: String) -> Bool {
        inputRuleLock.lock()
        defer { inputRuleLock.unlock() }
        guard inputRuleTriedRoutes.insert(route).inserted else { return false }
        return true
    }

    func clearInputRuleTriedRoutes() {
        inputRuleLock.lock()
        inputRuleTriedRoutes.removeAll()
        inputRuleLock.unlock()
    }

    // 経路の見分け: 入力・出力の portType・優先の入力・選択肢の生の値。
    func routeSignature(_ session: AVAudioSession) -> String {
        let inputs = session.currentRoute.inputs.map { $0.portType.rawValue }.joined(separator: ",")
        let outputs = session.currentRoute.outputs.map { $0.portType.rawValue }.joined(separator: ",")
        let preferred = session.preferredInput?.portType.rawValue ?? "-"
        return "\(inputs)|\(outputs)|\(preferred)|\(session.categoryOptions.rawValue)"
    }

    // 出口の規則: 受話口に出ているときだけ、本体のスピーカーへ寄せる。
    // イヤホン(有線・Bluetooth)やスピーカーに出ているときは何もしない ── .speaker の上書きは
    // 「つながっているイヤホンより本体のスピーカーを優先する」ので、イヤホンがあるときに呼んではいけない。
    // 上書きは経路が変わると OS が外す(イヤホンを挿せばイヤホンへ)。外したあとは defaultToSpeaker でスピーカーへ戻る。
    // スピーカーへ寄せた後は出口が builtInSpeaker になるので、この関数は2度目に何もしない(通知との往復が起きない)。
    func applyOutputRule(_ session: AVAudioSession) throws {
        let outputs = session.currentRoute.outputs.map { $0.portType }
        if outputs.contains(.builtInReceiver) {
            try session.overrideOutputAudioPort(.speaker)
        }
    }
}
