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
        CAPPluginMethod(name: "sessionInfo", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setTestMode", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "nativeClickLoad", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "nativeClickStart", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "nativeClickStop", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "nativeInputStart", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "nativeInputStop", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "nativeAudioInfo", returnType: CAPPluginReturnPromise)
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

    // 【便CT】診断の板の試し口で選んだモード(聞き比べ用)。nil = 既定の .default。**保存しない**(メモリだけ。アプリを開き直せば .default)。
    // routeToSpeaker(Capacitor の部品の列)・経路の変化(main)・setTestMode が読み書きするので、鍵で守る。
    private var testMode: AVAudioSession.Mode? = nil
    private let testModeLock = NSLock()
    // 試し口で選べるモード(板のボタンの名前 → モード)。これ以外の名前は断る。
    static let testModes: [String: AVAudioSession.Mode] = [
        "default": .default,
        "videoRecording": .videoRecording,
        "measurement": .measurement,
        "spokenAudio": .spokenAudio,
        "moviePlayback": .moviePlayback
    ]
    // いま求めるモード(試し口で選んでいればそれ、無ければ .default)。立て直しの setCategory の2か所(routeToSpeaker・経路の変化)と needsSessionReset が読む。
    func desiredMode() -> AVAudioSession.Mode {
        testModeLock.lock()
        defer { testModeLock.unlock() }
        return testMode ?? .default
    }

    @objc override public func load() {
        NotificationCenter.default.addObserver(self,
                                               selector: #selector(handleRouteChange(_:)),
                                               name: AVAudioSession.routeChangeNotification,
                                               object: nil)
        // 【便CU】診断の板の試し口「鳴らし方」: 裏へ行ったら殻のクリックと取り込みを止める(JS も板の側で web に戻す)
        NotificationCenter.default.addObserver(self,
                                               selector: #selector(handleTestEngineBackground(_:)),
                                               name: UIApplication.didEnterBackgroundNotification,
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
                try session.setCategory(.playAndRecord, mode: desiredMode(), options: FicusAudioSessionPlugin.sessionOptions)
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

    // 【便CT】診断の板の試し口: モードを替えて聞き比べる(default / videoRecording / measurement / spokenAudio / moviePlayback)。
    // 選んだモードはメモリにだけ持ち(保存しない)、以後の立て直し(routeToSpeaker・経路の変化)もそのモードで行う。
    // 取り込み中(playAndRecord)のときだけ受け、その場で setCategory する(種別と選択肢は sessionOptions のまま)。返すのは替えた後のモード(生の値)。
    // **iOS が受け付けなかったら(投げた・替わらなかった)前のモードに戻して reject する**(Apple の文書では moviePlayback は playback 用)。
    // 戻さないと、以後の立て直しが毎回 setCategory を投げて出口の規則まで届かない・替わらないモードを求め続けて経路の変化と往復する。
    @objc func setTestMode(_ call: CAPPluginCall) {
        guard let name = call.getString("mode"), let mode = FicusAudioSessionPlugin.testModes[name] else {
            call.reject("unknown mode")
            return
        }
        let session = AVAudioSession.sharedInstance()
        guard session.category == .playAndRecord else {
            // 【便CT 審査】板を閉じたときの戻し(default)は、取り込み中でなくても受けて既定へ戻す(次の立て直しは .default で行う)
            if mode == .default {
                storeTestMode(.default)
                call.resolve(["mode": session.mode.rawValue])
                return
            }
            call.reject("not playAndRecord")
            return
        }
        let previous = desiredMode()
        storeTestMode(mode)
        do {
            if session.mode != mode {
                try session.setCategory(.playAndRecord, mode: mode, options: FicusAudioSessionPlugin.sessionOptions)
            }
            guard session.mode == mode else {
                storeTestMode(previous)
                call.reject("not accepted: \(session.mode.rawValue)")
                return
            }
            call.resolve(["mode": session.mode.rawValue])
        } catch {
            storeTestMode(previous)
            call.reject("set mode: \(error.localizedDescription)")
        }
    }

    // 試し口のモードをメモリに置く(.default は nil = 選んでいない)。
    func storeTestMode(_ mode: AVAudioSession.Mode) {
        testModeLock.lock()
        testMode = (mode == .default) ? nil : mode
        testModeLock.unlock()
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
                    try session.setCategory(.playAndRecord, mode: self.desiredMode(), options: FicusAudioSessionPlugin.sessionOptions)
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
    // 【便CT】モードの比べる先は desiredMode()(診断の板の試し口で選んだモード。選んでいなければ .default = 今までどおり)。
    func needsSessionReset(_ session: AVAudioSession) -> Bool {
        return session.category != .playAndRecord
            || session.mode != desiredMode()
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

    // ============================================================
    // 【便CU 2026-10-17】診断の板の試し口「鳴らし方」(nativeClick / nativeBoth)。本番では誰も呼ばない(板で選んだときだけ・保存しない)。
    // 本人の実機: 便CT の試し口(このプロセスのセッションのモード 5種・マスターの倍率 ×1/1.3/1.6)では、聞こえる音量が変わらなかった。
    // 仮説: Web Audio の音とマイクの取り込みは WebKit の GPU プロセス側の音のセッションで動き、取り込み中 WebKit はそれを playAndRecord + videoChat
    // (通話)に立て直す。このプロセスのセッションを替えても聞こえる音に効かないのはそのため。そこでメトロノームのクリックを**このプロセスの
    // AVAudioEngine** で鳴らし(nativeClick)、さらに Web の取り込みを止めて**このプロセスで**マイクを取る(nativeBoth)と大きくなるかを見る。
    //   クリックの音: JS が OfflineAudioContext で描いた今の Web のクリック(3段・モノラルの Float32・base64)を nativeClickLoad で1回受け取る。
    //   鳴らし方: AVAudioPlayerNode に sample time で予約する。予約の値は Web の metroSchedulerTick と同じ(25ms ごとに 0.12 秒先まで・
    //            始めは今から 0.12 秒後・1回の予約は 512 個まで)。1小節ぶんの並び(stepSec ごとの kinds)は JS が渡し、設定が変わったら渡し直す。
    //   取り込み: inputNode のハードウェアの形式(inputFormat(forBus: 0))でタップを付け、入力のレベル(RMS の dBFS)だけを控える(標本は捨てる)。
    //   セッション: 種別・モード・選択肢は今のまま(ここでは種別を替えない)。エンジンを始める前に setActive(true)(失敗は記録だけ)。
    //            止めるときも非活性にはしない(WebKit の音まで止めうるため)。
    //   止める: nativeClickStop / nativeInputStop(両方止まればエンジンを捨てる)・裏へ行く(didEnterBackground)・エンジンの構成の変化
    //          (AVAudioEngineConfigurationChange。エンジンは止まるので捨てて記録する。自分では始め直さない ── 板で同じボタンを押すと始め直す)。
    // エンジンの操作はすべて testQueue(直列)の上で行う。タップの中(音のスレッド)は入力のレベルを鍵の中で書くだけ。
    // ============================================================
    private let testQueue = DispatchQueue(label: "FicusAudioSession.testEngine")
    private var testEngine: AVAudioEngine? = nil
    private var testPlayer: AVAudioPlayerNode? = nil
    private var testTapInstalled = false
    private var clickFormat: AVAudioFormat? = nil
    private var clickBuffers: [String: AVAudioPCMBuffer] = [:]
    private var clickKinds: [String] = []
    private var clickStepSec: Double = 0
    private var clickOn = false
    private var clickIndex = 0
    private var clickNextSample: Double = -1
    private var clickTimer: DispatchSourceTimer? = nil
    private var inputOn = false
    private var testLastError = ""
    private var testConfigChanges = 0
    // 【便CU 審査】このプロセスで setActive(true) かエンジンの start を一度でも成功させたか(以後ずっと true。非活性には戻さないので、
    // 一度この試しを使うと、起動し直すまでこのプロセスのセッションは活性のまま = web の聞こえ方が試しの前と同じとは限らない)。板の act= に出す
    private var testActivated = false
    private var inputLevelDb: Double? = nil
    private let inputLevelLock = NSLock()
    // Web の metroSchedulerTick と同じ値(LOOKAHEAD 0.12 秒・setInterval 25ms・始めは currentTime + 0.12・guard 512)
    static let clickLookaheadSec: Double = 0.12
    static let clickTimerMs: Int = 25
    static let clickMaxPerTick: Int = 512
    // タップの大きさ(フレーム。iOS は目安として扱う)。入力のレベルを見るだけなので小さくなくてよい
    static let inputTapFrames: AVAudioFrameCount = 4096

    // { sampleRate, accent, beat, sub }(3つは Float32 の標本の base64)。形式(標本化周波数)が替わったらエンジンを作り直す。
    @objc func nativeClickLoad(_ call: CAPPluginCall) {
        guard let rate = call.getDouble("sampleRate"), rate > 0,
              let format = AVAudioFormat(standardFormatWithSampleRate: rate, channels: 1) else {
            call.reject("bad sampleRate")
            return
        }
        var buffers: [String: AVAudioPCMBuffer] = [:]
        for kind in ["accent", "beat", "sub"] {
            guard let b64 = call.getString(kind),
                  let buffer = FicusAudioSessionPlugin.pcmBuffer(base64: b64, format: format) else {
                call.reject("bad buffer: \(kind)")
                return
            }
            buffers[kind] = buffer
        }
        let loaded = buffers
        testQueue.async {
            // 今のエンジンのプレーヤーは前の形式(無ければ既定の形式)でつないである。形式が違うバッファを予約すると落ちるので、作り直す
            let formatChanged = self.clickFormat?.sampleRate != format.sampleRate
            self.clickFormat = format
            self.clickBuffers = loaded
            if formatChanged && self.testEngine != nil {
                self.teardownTestEngine()
                if self.clickOn || self.inputOn { self.startTestEngineAndClick() }
            }
            call.resolve(["frames": loaded.mapValues { Int($0.frameLength) }])
        }
    }

    // { stepSec, kinds }(1小節ぶんの並び)で鳴らし始める。もう鳴っていれば頭から始め直す。
    @objc func nativeClickStart(_ call: CAPPluginCall) {
        let kinds = (call.getArray("kinds") ?? []).compactMap { $0 as? String }
        guard let step = call.getDouble("stepSec"), step > 0, !kinds.isEmpty else {
            call.reject("bad pattern")
            return
        }
        testQueue.async {
            guard self.clickFormat != nil, !self.clickBuffers.isEmpty else {
                call.reject("not loaded")
                return
            }
            self.clickKinds = kinds
            self.clickStepSec = step
            self.clickOn = true
            if let err = self.startTestEngineAndClick() {
                call.reject(err)
                return
            }
            call.resolve(["running": self.testEngine?.isRunning ?? false])
        }
    }

    @objc func nativeClickStop(_ call: CAPPluginCall) {
        testQueue.async {
            self.clickOn = false
            self.clickTimer?.cancel()
            self.clickTimer = nil
            self.testPlayer?.stop()
            if !self.inputOn { self.teardownTestEngine() }
            call.resolve()
        }
    }

    // 取り込み中(playAndRecord)のときだけ受ける(ここでは種別を替えない)。入力を足すのでエンジンを作り直す(鳴らしていれば始め直す)。
    @objc func nativeInputStart(_ call: CAPPluginCall) {
        guard AVAudioSession.sharedInstance().category == .playAndRecord else {
            call.reject("not playAndRecord")
            return
        }
        testQueue.async {
            self.inputOn = true
            self.teardownTestEngine()
            if let err = self.startTestEngineAndClick() {
                self.inputOn = false
                if self.clickOn { self.startTestEngineAndClick() }
                call.reject(err)
                return
            }
            call.resolve(["running": self.testEngine?.isRunning ?? false])
        }
    }

    // 入力を外す(エンジンを捨てる。鳴らしていれば入力なしで始め直す)。
    // 【便CU 審査】web へ戻すとき JS は nativeClickStop を先に呼ぶので、ここへ来たときは clickOn = false = 鳴らし直さない(Web と二重に鳴らさない)。
    // 鳴らし直すのは nativeBoth → nativeClick のときだけ。
    @objc func nativeInputStop(_ call: CAPPluginCall) {
        testQueue.async {
            self.inputOn = false
            self.teardownTestEngine()
            self.inputLevelLock.lock()
            self.inputLevelDb = nil
            self.inputLevelLock.unlock()
            if self.clickOn { self.startTestEngineAndClick() }
            call.resolve()
        }
    }

    // 板が1秒ごとに読む(読むだけ)。inputDb は取り込みのタップが1回でも来ていれば。
    @objc func nativeAudioInfo(_ call: CAPPluginCall) {
        testQueue.async {
            var info: [String: Any] = [
                "engineRunning": self.testEngine?.isRunning ?? false,
                "clickOn": self.clickOn,
                "inputOn": self.inputOn,
                "lastError": self.testLastError,
                "configChanges": self.testConfigChanges,
                "activated": self.testActivated
            ]
            self.inputLevelLock.lock()
            let db = self.inputLevelDb
            self.inputLevelLock.unlock()
            if let db = db { info["inputDb"] = db }
            call.resolve(info)
        }
    }

    // エンジンを用意して(無ければ作る)、鳴らしていればクリックの予約を頭から始め直す。失敗は testLastError に控え、エンジンを捨てて返す。testQueue の上で呼ぶ。
    @discardableResult
    private func startTestEngineAndClick() -> String? {
        if let err = ensureTestEngine() {
            testLastError = err
            teardownTestEngine()
            return err
        }
        clickTimer?.cancel()
        clickTimer = nil
        testPlayer?.stop()
        clickIndex = 0
        clickNextSample = -1
        guard clickOn, let player = testPlayer else { return nil }
        // 【便CU 審査】動いていないエンジンのプレーヤーに play を呼ぶと例外で落ちる
        guard let engine = testEngine, engine.isRunning else {
            testLastError = "engine not running"
            return "engine not running"
        }
        player.play()
        let timer = DispatchSource.makeTimerSource(queue: testQueue)
        timer.schedule(deadline: .now(), repeating: .milliseconds(FicusAudioSessionPlugin.clickTimerMs))
        timer.setEventHandler { [weak self] in self?.clickTick() }
        clickTimer = timer
        timer.resume()
        return nil
    }

    // エンジン(プレーヤー → mainMixer。nativeBoth のときは入力のタップも)を作って始める。失敗の文を返す。testQueue の上で呼ぶ。
    private func ensureTestEngine() -> String? {
        if let engine = testEngine {
            if engine.isRunning { return nil }
            do {
                try engine.start()
                testActivated = true
                return nil
            } catch {
                return "start: \(error.localizedDescription)"
            }
        }
        do {
            try AVAudioSession.sharedInstance().setActive(true)
            testActivated = true
        } catch {
            testLastError = "setActive: \(error.localizedDescription)"
        }
        let engine = AVAudioEngine()
        let player = AVAudioPlayerNode()
        engine.attach(player)
        engine.connect(player, to: engine.mainMixerNode, format: clickFormat)
        testEngine = engine
        testPlayer = player
        if inputOn {
            let input = engine.inputNode
            let format = input.inputFormat(forBus: 0) // ハードウェアの形式(別の形式を渡すとタップが落ちる)
            guard format.sampleRate > 0, format.channelCount > 0 else { return "no input format" }
            input.removeTap(onBus: 0)
            input.installTap(onBus: 0, bufferSize: FicusAudioSessionPlugin.inputTapFrames, format: format) { [weak self] buffer, _ in
                self?.noteInputLevel(buffer)
            }
            testTapInstalled = true
        }
        NotificationCenter.default.addObserver(self,
                                               selector: #selector(handleTestEngineConfigChange(_:)),
                                               name: .AVAudioEngineConfigurationChange,
                                               object: engine)
        engine.prepare()
        do {
            try engine.start()
            testActivated = true
        } catch {
            return "start: \(error.localizedDescription)"
        }
        return nil
    }

    // 25ms ごと(testQueue)。プレーヤーの時計(sample time)で 0.12 秒先までのクリックを予約する。過ぎてしまっていたら今から 0.12 秒後へ置き直す。
    private func clickTick() {
        guard clickOn, !clickKinds.isEmpty, clickStepSec > 0,
              let engine = testEngine, engine.isRunning, let player = testPlayer,
              let nodeTime = player.lastRenderTime, nodeTime.isSampleTimeValid,
              let playerTime = player.playerTime(forNodeTime: nodeTime) else { return }
        let rate = playerTime.sampleRate
        let now = Double(playerTime.sampleTime)
        let ahead = FicusAudioSessionPlugin.clickLookaheadSec * rate
        if clickNextSample < now { clickNextSample = now + ahead }
        var count = 0
        while clickNextSample < now + ahead && count < FicusAudioSessionPlugin.clickMaxPerTick {
            count += 1
            let kind = clickKinds[clickIndex % clickKinds.count]
            if let buffer = clickBuffers[kind] {
                player.scheduleBuffer(buffer,
                                      at: AVAudioTime(sampleTime: AVAudioFramePosition(clickNextSample), atRate: rate),
                                      options: [],
                                      completionHandler: nil)
            }
            clickIndex = (clickIndex + 1) % clickKinds.count
            clickNextSample += clickStepSec * rate
        }
    }

    // 予約の時計・プレーヤー・タップ・エンジンを片付ける(clickOn / inputOn はそのまま)。testQueue の上で呼ぶ。
    private func teardownTestEngine() {
        clickTimer?.cancel()
        clickTimer = nil
        clickNextSample = -1
        if let engine = testEngine {
            NotificationCenter.default.removeObserver(self, name: .AVAudioEngineConfigurationChange, object: engine)
            testPlayer?.stop()
            if testTapInstalled { engine.inputNode.removeTap(onBus: 0) }
            engine.stop()
        }
        testTapInstalled = false
        testEngine = nil
        testPlayer = nil
    }

    // 入力のレベル(RMS の dBFS)。タップのスレッドで呼ばれる。
    private func noteInputLevel(_ buffer: AVAudioPCMBuffer) {
        guard let samples = buffer.floatChannelData?[0] else { return }
        let n = Int(buffer.frameLength)
        guard n > 0 else { return }
        var sum: Float = 0
        for i in 0..<n { sum += samples[i] * samples[i] }
        let db = 20 * log10(Double(sqrt(sum / Float(n))) + 1e-10)
        inputLevelLock.lock()
        inputLevelDb = db
        inputLevelLock.unlock()
    }

    // エンジンの構成が変わった(経路の変化など)。エンジンは止まっているので捨て、回数と理由を控える(自分では始め直さない)。
    @objc func handleTestEngineConfigChange(_ notification: Notification) {
        testQueue.async {
            guard let engine = notification.object as? AVAudioEngine, engine === self.testEngine else { return }
            self.testConfigChanges += 1
            self.testLastError = "configurationChange"
            self.teardownTestEngine()
        }
    }

    // 裏へ行った: クリックも取り込みも止める(戻っても勝手に鳴らさない)。
    @objc func handleTestEngineBackground(_ notification: Notification) {
        testQueue.async {
            self.clickOn = false
            self.inputOn = false
            self.teardownTestEngine()
        }
    }

    // base64 の Float32 の標本 → この形式(モノラル・Float32)のバッファ。
    static func pcmBuffer(base64: String, format: AVAudioFormat) -> AVAudioPCMBuffer? {
        guard let data = Data(base64Encoded: base64) else { return nil }
        let frames = data.count / MemoryLayout<Float>.size
        guard frames > 0,
              let buffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: AVAudioFrameCount(frames)),
              let dst = buffer.floatChannelData?[0] else { return nil }
        data.withUnsafeBytes { (raw: UnsafeRawBufferPointer) in
            if let base = raw.baseAddress { memcpy(dst, base, frames * MemoryLayout<Float>.size) }
        }
        buffer.frameLength = AVAudioFrameCount(frames)
        return buffer
    }
}
