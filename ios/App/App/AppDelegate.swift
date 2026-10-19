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

// ============================================================
// 【便CX 2026-10-19】殻の計測タブの音(メトロノームとマイク)は、このプロセス(アプリ)の AVAudioEngine で扱う。
// 原因(本人の実機・診断の板の試し口 nativeSolo で確定): WebKit の getUserMedia と play-and-record の Web AudioContext が動いている間、
// WebKit の GPU プロセス側の音のセッションが通話(videoChat)の段になり、アプリ全体の音量がその段に縛られる(MAX でも普段の段の 1/4 ほど)。
// 殻ではメトロノームを殻の AVAudioPlayerNode で鳴らし、マイクも殻の inputNode から取り、WebKit には音もマイクも触らせない。
//   セッション: playAndRecord・mode .default・options sessionOptions(defaultToSpeaker + allowBluetoothA2DP)。殻が自分で setActive(true) する。
//   マイク: inputNode → AVAudioSinkNode(ハードウェアの形式。受け手は I/O の周期ごとに音のスレッドで呼ばれる)。エンジンが始まらない・始めて 1 秒
//           受け手が来ないときは installTap に戻る(Apple の文書ではタップの塊は [100, 400] ms)。JS が micStart を呼ぶたびに sink をもう一度試す。
//           受け手は前もって確保した輪(MicRing)にモノラルで写し、micQueue へ知らせるだけ。
//           micQueue が塊を組み立てて Float32 の base64 を "micData" で JS へ送る(各塊に入力の sample time と host time)。許可は requestRecordPermission。
//   メトロノーム: JS が描いた3段のクリック(metroLoad)を、プレーヤーの sample time で予約する(先読み 0.12 秒・25ms ごと・1回 512 個まで = Web の metroSchedulerTick と同じ値)。
//           予約は host time(このプロセスの時計 = マイクの塊と同じ時計)で数え、予約したクリックを "metroClicks" で JS へ知らせる。作り直しても拍の格子は続ける。
//   作り直し: エンジンの構成の変化・中断の終わり・メディアサービスのリセットで捨てて作り直す(1 秒に 1 回まで・10 秒に 5 回まで・失敗は 5 回まで・
//           中断の終わりは失敗の数を 0 に戻す)。諦めたら "audioState"(failed)を JS へ知らせる(JS はマイクを既存の復旧の入口で取り直し、メトロノームは止める)。
//   JS への知らせ(notifyListeners)は emit の1か所から、それを呼ぶ列(micData は micQueue・ほかは audioQueue)の上でそのまま送る(main で JSON にしない)。
//           JS の受け手の登録の書き換え(addListener / removeListener)は Capacitor の bridge の列で行われ、この知らせとは同期しない。そのため JS は
//           受け手を最初の1回だけ(3つの知らせをまとめて、マイクを始める前に)登録し、流している間は書き換えない(src/shell/nativeAudio.js の nativeEvents)。
//   【便CX】WebKit がもう音のセッションを立て直さないので、JS から呼んでいた routeToSpeaker(マイクの直後・メトロノームの開始・鳴り始めた後・機器の一覧の変化)と
//           診断の板の試し口(setTestMode・nativeClick* / nativeInput*)は消した。セッションの用意はエンジンを始める前の configureSession の1か所。
// ============================================================

// マイクの輪(1つの書き手 = sink の受け手かタップの受け手・1つの読み手 = micQueue の drainMic)。
// 置き場はすべて作るときに1回だけ確保し、プロパティは let(受け手の中でクラスの var に触らない = 排他の確かめ・確保・鍵が無い)。
// 書き手は標本と「その回の情報」(フレーム数・host time の生の値・sample time・標本化周波数)を書いてから、知らせ(ユーザデータ)に
// 「回数 << 32 | フレーム数」を足す。dispatch の知らせは足し算でまとまり、読み手は届いた回数ぶんの情報を順に読む。
// 【根拠なし・実機で見る】音のスレッドから dispatch_source_merge_data(add(data:))を呼んでよいか(確保・鍵が無いか)と、足し算が書いた中身を読み手に
// 見せる順序(メモリの順序)を保証するかは、一次情報で確かめられていない。実機で板の nativeIn(cb・send・ovr)と音の途切れを見る。
final class MicRing {
    static let capacity = 1 << 16       // 標本(48kHz で約 1.4 秒)
    static let mask = capacity - 1
    static let metaCapacity = 1 << 10   // 受け手の回数
    static let metaMask = metaCapacity - 1
    let queue: DispatchQueue
    let samples: UnsafeMutablePointer<Float>
    let metaFrames: UnsafeMutablePointer<Int>
    let metaHost: UnsafeMutablePointer<UInt64>
    let metaSample: UnsafeMutablePointer<Double>
    let metaRate: UnsafeMutablePointer<Double>
    let writePos: UnsafeMutablePointer<Int>
    let metaWrite: UnsafeMutablePointer<Int>
    let signal: DispatchSourceUserDataAdd

    init() {
        samples = UnsafeMutablePointer<Float>.allocate(capacity: MicRing.capacity)
        samples.initialize(repeating: 0, count: MicRing.capacity)
        metaFrames = UnsafeMutablePointer<Int>.allocate(capacity: MicRing.metaCapacity)
        metaFrames.initialize(repeating: 0, count: MicRing.metaCapacity)
        metaHost = UnsafeMutablePointer<UInt64>.allocate(capacity: MicRing.metaCapacity)
        metaHost.initialize(repeating: 0, count: MicRing.metaCapacity)
        metaSample = UnsafeMutablePointer<Double>.allocate(capacity: MicRing.metaCapacity)
        metaSample.initialize(repeating: 0, count: MicRing.metaCapacity)
        metaRate = UnsafeMutablePointer<Double>.allocate(capacity: MicRing.metaCapacity)
        metaRate.initialize(repeating: 0, count: MicRing.metaCapacity)
        writePos = UnsafeMutablePointer<Int>.allocate(capacity: 1)
        writePos.initialize(to: 0)
        metaWrite = UnsafeMutablePointer<Int>.allocate(capacity: 1)
        metaWrite.initialize(to: 0)
        let q = DispatchQueue(label: "FicusAudioSession.mic")
        queue = q
        signal = DispatchSource.makeUserDataAddSource(queue: q)
    }

    deinit {
        signal.cancel()
        samples.deallocate()
        metaFrames.deallocate()
        metaHost.deallocate()
        metaSample.deallocate()
        metaRate.deallocate()
        writePos.deallocate()
        metaWrite.deallocate()
    }

    // 受け手(sink のときは音のスレッド)。確保・鍵・待ちをしない。モノラル(全チャンネルの平均)にして輪へ写し、知らせに足すだけ。
    func write(_ timestamp: UnsafePointer<AudioTimeStamp>, _ frameCount: AVAudioFrameCount, _ bufferList: UnsafePointer<AudioBufferList>, _ rate: Double) {
        let n = Int(frameCount)
        if n <= 0 || n > MicRing.capacity / 2 { return }
        let buffers = UnsafeMutableAudioBufferListPointer(UnsafeMutablePointer(mutating: bufferList))
        var channels = 0
        for b in buffers { channels += Int(b.mNumberChannels) }
        if channels <= 0 { return }
        let scale = 1 / Float(channels)
        let w = writePos.pointee
        var first = true
        for b in buffers {
            guard let raw = b.mData else { continue }
            let nc = Int(b.mNumberChannels)
            if nc <= 0 { continue }
            let src = raw.assumingMemoryBound(to: Float.self)
            for i in 0..<n {
                var s: Float = 0
                for c in 0..<nc { s += src[i * nc + c] }
                let idx = (w + i) & MicRing.mask
                if first { samples[idx] = s * scale } else { samples[idx] += s * scale }
            }
            first = false
        }
        if first { return }
        let m = metaWrite.pointee & MicRing.metaMask
        let flags = timestamp.pointee.mFlags
        metaFrames[m] = n
        metaHost[m] = flags.contains(.hostTimeValid) ? timestamp.pointee.mHostTime : 0
        metaSample[m] = flags.contains(.sampleTimeValid) ? timestamp.pointee.mSampleTime : -1
        metaRate[m] = rate
        metaWrite.pointee = metaWrite.pointee + 1
        writePos.pointee = w + n
        signal.add(data: (UInt(1) << 32) | UInt(n))
    }
}

@objc(FicusAudioSessionPlugin)
public class FicusAudioSessionPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "FicusAudioSessionPlugin"
    public let jsName = "FicusAudioSession"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "sessionInfo", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "micStart", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "micStop", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "metroLoad", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "metroStart", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "metroUpdate", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "metroStop", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "audioClock", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "audioInfo", returnType: CAPPluginReturnPromise)
    ]

    // 殻の音のセッションの選択肢(値の唯一の答え)。【本人裁定 2026-10-05】Bluetooth のイヤホンへは出す(allowBluetoothA2DP = 出力だけ Bluetooth)。
    // HFP は付けない ── マイクが Bluetooth 側へ替わり、音が電話の品質に落ちるため。有線・Bluetooth のイヤホンがつながっていればそちらへ、無ければスピーカーへ。
    static let sessionOptions: AVAudioSession.CategoryOptions = [.defaultToSpeaker, .allowBluetoothA2DP]
    // モード(殻の仕様 §4.4・【便CQ】)。【便CX】診断の板の試し口(setTestMode)は消したので、いつも .default。
    static let sessionMode: AVAudioSession.Mode = .default
    // 入出力の I/O の長さの希望(秒)。sink の受け手はこの周期で呼ばれる(iOS は目安として扱う。48kHz で約 256 フレーム)。失敗しても続ける
    static let preferredIOBufferSec: Double = 0.005

    // 【便CS】入力の規則で setPreferredInput を一度呼んだ経路(routeSignature)。同じ経路ではもう呼ばない ──
    // iOS と往復しても、呼ぶ回数は経路の種類の数までで止まる(時間の値は使わない)。
    // 入力が本体のマイクになったら・殻の音が止まったら(経路の変化で見る)空にするので、**エンジンを始めるたびに1周し直す**。
    // configureSession(audioQueue)・経路の変化(audioQueue)が読み書きするが、念のため鍵で守る。
    private var inputRuleTriedRoutes = Set<String>()
    private let inputRuleLock = NSLock()

    // ---- エンジンの状態(すべて audioQueue の上だけで読み書きする) ----
    private let audioQueue = DispatchQueue(label: "FicusAudioSession.engine")
    // マイクの輪と、塊を組み立てて JS へ送る列(micQueue = 輪の知らせの列)
    private let micRing = MicRing()
    private var micQueue: DispatchQueue { return micRing.queue }
    private var engine: AVAudioEngine? = nil
    private var player: AVAudioPlayerNode? = nil
    private var sinkNode: AVAudioSinkNode? = nil
    private var engineHasInput = false
    private var tapInstalled = false
    private var sinkUnavailable = false   // sink のエンジンが始まらなかった・届かなかった(次の micStart まで installTap を使う。作り直しの最中はこのまま)
    private var micOn = false
    private var metroOn = false
    // メトロノーム
    private var clickFormat: AVAudioFormat? = nil
    private var clickBuffers: [String: AVAudioPCMBuffer] = [:]
    // プレーヤーをつないだ形式の標本化周波数(バッファはこの形式でないと予約できない。違えば作り直す)
    private var playerRate: Double = 0
    private var metroKinds: [String] = []
    private var metroStepSec: Double = 0
    private var metroVersion = 0
    private var metroRun = 0
    private var metroIndex = 0
    private var metroTick = 0              // この run で数えた並びの通し番号(JS へ n として渡す。同じ番号の知らせは JS が捨てる)
    private var metroNextHost: Double = -1
    private var metroLeadSec: Double = 0.12
    // 予約したがまだ鳴っていない(かもしれない)クリック。作り直しのとき、まだ来ていない最初のものから予約し直す(格子を途切れさせない)
    private var metroPending: [(host: Double, index: Int, tick: Int)] = []
    private var clickTimer: DispatchSourceTimer? = nil
    // 再生し終わったクリックを数えるための世代(止めた・作り直したとき〈teardown・予約のやり直し〉に進める)
    private var metroEpoch = 0
    // 作り直し
    private var rebuildScheduled = false
    private var lastRebuildAt: CFAbsoluteTime = 0
    private var rebuildFailures = 0
    private var rebuildTimes: [Double] = []
    // 診断の板に出す数
    private var configChanges = 0
    private var rebuilds = 0
    private var scheduled = 0
    private var played = 0
    private var lastError = ""
    private var lastTickReason = "idle"
    private var noRenderTicks = 0
    private var activated = false

    // ---- マイクの id・入力の様子(micQueue・audioQueue から読むので鍵で守る。受け手の中では触らない) ----
    private let micLock = NSLock()
    private var micId = ""
    private var micVia = "none"            // sink / tap / none(板の nativeIn)
    private var micChunks = 0
    private var micCallbacks = 0           // 読み手が読んだ受け手の回数
    private var cbFramesLast = 0           // 1回の受け手のフレーム数(直近・最大)
    private var cbFramesMax = 0
    private var sendMsLast: Double = 0     // 塊を送る間隔(直近・最大)
    private var sendMsMax: Double = 0
    private var lastFlushAt: CFAbsoluteTime = 0
    private var micOverruns = 0
    private var inputLevelDb: Double? = nil
    private var inputRate: Double = 0
    // ---- 読み手(micQueue の上だけ) ----
    private var micReadPos = 0
    private var micMetaRead = 0
    private var micScratch: [Float] = [Float](repeating: 0, count: MicRing.capacity / 2)
    private var micPending: [Float] = []
    private var micPendingId = ""
    private var micPendingSample: Double = 0
    private var micPendingHost: Double = 0
    private var micPendingRate: Double = 0

    // Web の metroSchedulerTick と同じ値(LOOKAHEAD 0.12 秒・setInterval 25ms・始めは今から 0.12 秒後・guard 512)
    static let clickLookaheadSec: Double = 0.12
    static let clickTimerMs: Int = 25
    static let clickMaxPerTick: Int = 512
    static let clickLeadSec: Double = 0.12
    // メトロノームを止めてからエンジンを捨てるまでの待ち(先読み 0.12 秒 + クリックの長さ 0.09 秒 + 余裕)。予約済みのクリックを鳴り切らせる
    static let metroStopTeardownSec: Double = 0.25
    // 作り直し: 連続は 1 秒に 1 回まで(暴走防止)・通知から 0.2 秒は経路が落ち着くのを待つ・失敗は 5 回まで・10 秒に 5 回まで
    // (間隔の下限が 1 秒なので 10 秒の窓に入るのは最大 9〜10 件。上限は窓に必ず届く 5)
    static let rebuildMinIntervalSec: Double = 1.0
    static let rebuildSettleSec: Double = 0.2
    static let rebuildMaxFailures: Int = 5
    static let rebuildWindowSec: Double = 10.0
    static let rebuildMaxInWindow: Int = 5
    // プレーヤーの時計が有効にならないまま続いたら(25ms × 8 = 0.2 秒)、無音の短いバッファを1つ予約して時計を動かす
    static let primeAfterTicks: Int = 8
    static let primeFrames: AVAudioFrameCount = 512
    // installTap に戻ったときの塊の大きさの希望(フレーム)。Apple の文書ではタップの塊は [100, 400] ms(48kHz で 4800〜19200)なので、下限の 100ms を頼む
    static let micTapFrames: AVAudioFrameCount = 4800
    // JS へ送る塊の下限(フレーム)。sink の受け手は I/O の周期(約 5ms・約 256 フレーム)ごとに来るので、1024(48kHz で約 21ms)まで溜めて送る ──
    // 解析は画面の1コマ(約 17ms)に1回、直近 8192 点(約 170ms)の窓で回るので、これより細かくしても見え方は変わらず、ブリッジの往復だけが増える。
    // タップに戻ったときは1回の塊(100〜400ms)がこれより大きいので、そのまま1つで送る。
    static let micChunkFrames: Int = 1024
    // sink の受け手がこの時間 1 回も来なければ、installTap に戻して作り直す
    static let sinkCheckSec: Double = 1.0

    @objc override public func load() {
        micRing.signal.setEventHandler { [weak self] in self?.drainMic() }
        micRing.signal.resume()
        NotificationCenter.default.addObserver(self,
                                               selector: #selector(handleRouteChange(_:)),
                                               name: AVAudioSession.routeChangeNotification,
                                               object: nil)
        // 裏へ行ったらクリックも取り込みも止める(JS も visibilitychange で止める。戻っても勝手に鳴らさない)
        NotificationCenter.default.addObserver(self,
                                               selector: #selector(handleDidEnterBackground(_:)),
                                               name: UIApplication.didEnterBackgroundNotification,
                                               object: nil)
        // 中断(電話・Siri など)が終わったら、動いていたエンジンを作り直す
        NotificationCenter.default.addObserver(self,
                                               selector: #selector(handleInterruption(_:)),
                                               name: AVAudioSession.interruptionNotification,
                                               object: nil)
        // メディアサービスのリセット(エンジンが使えなくなる)でも作り直す
        NotificationCenter.default.addObserver(self,
                                               selector: #selector(handleMediaServicesReset(_:)),
                                               name: AVAudioSession.mediaServicesWereResetNotification,
                                               object: nil)
    }

    deinit {
        NotificationCenter.default.removeObserver(self)
    }

    // JS への知らせ(この1か所だけが notifyListeners を呼ぶ)。呼んだ列(micQueue / audioQueue)の上でそのまま送る(main で JSON にしない)。
    // JS の受け手の登録の書き換えは bridge の列で行われ、この知らせとは同期しないので、JS は受け手を最初の1回だけ登録して書き換えない。
    private func emit(_ event: String, _ data: [String: Any]) {
        notifyListeners(event, data: data)
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

    // 【便CS】port の portType(生の値)と名前。診断の板が読む。
    static func portInfo(_ port: AVAudioSessionPortDescription) -> [String: String] {
        return ["portType": port.portType.rawValue, "name": port.portName]
    }

    // ============================================================
    // マイク
    // ============================================================

    // { id } でマイクを取り始める。許可は AVAudioSession の requestRecordPermission(まだ決まっていなければ OS の許可の画面が出る)。
    // 断られていれば reject("denied")。JS は今の拒否の案内(「マイクの使用が許可されていません」)をそのまま出す。答えは { sampleRate }(ハードウェアの入力の標本化周波数)。
    @objc func micStart(_ call: CAPPluginCall) {
        let id = call.getString("id") ?? ""
        let session = AVAudioSession.sharedInstance()
        switch session.recordPermission {
        case .granted:
            startMicOnQueue(call, id)
        case .denied:
            call.reject("denied", "DENIED")
        case .undetermined:
            session.requestRecordPermission { [weak self] granted in
                guard let self = self else { return }
                if granted {
                    self.startMicOnQueue(call, id)
                } else {
                    call.reject("denied", "DENIED")
                }
            }
        @unknown default:
            call.reject("denied", "DENIED")
        }
    }

    private func startMicOnQueue(_ call: CAPPluginCall, _ id: String) {
        audioQueue.async {
            self.micOn = true
            self.setMicId(id)
            self.rebuildFailures = 0
            self.rebuildTimes.removeAll()
            // JS から micStart が来るたびに sink をもう一度試す(前に tap へ戻っていても。作り直しの最中は戻したまま)
            self.sinkUnavailable = false
            if let err = self.ensureMic() {
                self.micOn = false
                self.setMicId("")
                self.lastError = err
                if !self.metroOn { self.teardownEngine() }
                call.reject(err)
                return
            }
            call.resolve(["sampleRate": self.currentInputRate()])
        }
    }

    // { id } のマイクを止める。id が今のマイクと違えば何もしない(古い取得の片付けが、新しい取得を止めない)。
    // メトロノームが鳴っていなければエンジンも捨てる(橙の印が消える)。鳴っていれば入力はつないだまま、読み手が捨てる(id が空)。
    @objc func micStop(_ call: CAPPluginCall) {
        let id = call.getString("id") ?? ""
        audioQueue.async {
            if !id.isEmpty && id != self.getMicId() {
                call.resolve(["stopped": false])
                return
            }
            self.micOn = false
            self.setMicId("")
            if !self.metroOn { self.teardownEngine() }
            call.resolve(["stopped": true])
        }
    }

    // エンジン(入力つき)を用意する。動いていて sink で取っていれば何もしない(新しい id の塊は読み手が送る)。
    // メトロノームだけのエンジン・tap で取っているエンジンなら作り直す(sink をもう一度試す。拍の格子は teardownEngine が引き継ぐ)。audioQueue の上で呼ぶ。
    private func ensureMic() -> String? {
        if let engine = engine, engine.isRunning, engineHasInput, sinkNode != nil {
            return nil
        }
        teardownEngine()
        return startEngine()
    }

    // inputNode → AVAudioSinkNode をハードウェアの形式でつなぐ。sinkUnavailable(エンジンが始まらなかった・1 秒届かなかった)なら installTap(付ける直前に removeTap)。
    // どちらも受け手は輪(MicRing)へ写して知らせるだけ。エンジンを始める前に audioQueue の上で呼ぶ。
    // (つなげたかを前もって確かめる手は使わない: connect は失敗を返さないので、効くのは「始まらない」「届かない」の2つだけ)
    private func installMicInput(_ engine: AVAudioEngine) -> String? {
        let input = engine.inputNode
        engineHasInput = true
        let format = input.inputFormat(forBus: 0) // ハードウェアの形式(別の形式を渡すと落ちる)
        guard format.sampleRate > 0, format.channelCount > 0 else { return "no input format" }
        let ring = micRing
        let rate = format.sampleRate
        setInputRate(rate)
        if !sinkUnavailable {
            let sink = AVAudioSinkNode { (timestamp, frameCount, bufferList) -> OSStatus in
                ring.write(timestamp, frameCount, bufferList, rate)
                return noErr
            }
            engine.attach(sink)
            engine.connect(input, to: sink, format: format)
            sinkNode = sink
            setMicVia("sink")
            return nil
        }
        input.removeTap(onBus: 0)
        input.installTap(onBus: 0, bufferSize: FicusAudioSessionPlugin.micTapFrames, format: format) { buffer, when in
            var stamp = when.audioTimeStamp
            withUnsafePointer(to: &stamp) { ring.write($0, buffer.frameLength, buffer.audioBufferList, rate) }
        }
        tapInstalled = true
        setMicVia("tap")
        return nil
    }

    // micQueue の上(輪の知らせ)。届いた回数ぶんの情報を順に読み、標本を写して塊に溜める。読み手が遅れて輪が回り切った恐れがあれば、その分は捨てる。
    private func drainMic() {
        let data = micRing.signal.data
        var callbacks = Int(data >> 32)
        let frames = Int(data & 0xFFFF_FFFF)
        if callbacks > MicRing.metaCapacity / 2 || frames > MicRing.capacity / 2 {
            micMetaRead += callbacks
            micReadPos += frames
            flushMic()
            micLock.lock()
            micOverruns += 1
            micLock.unlock()
            return
        }
        while callbacks > 0 {
            let m = micMetaRead & MicRing.metaMask
            let f = micRing.metaFrames[m]
            let hostRaw = micRing.metaHost[m]
            let sample = micRing.metaSample[m]
            let rate = micRing.metaRate[m]
            micMetaRead += 1
            callbacks -= 1
            guard f > 0, f <= micScratch.count, rate > 0 else { continue }
            for i in 0..<f { micScratch[i] = micRing.samples[(micReadPos + i) & MicRing.mask] }
            micReadPos += f
            micLock.lock()
            micCallbacks += 1
            cbFramesLast = f
            cbFramesMax = max(cbFramesMax, f)
            micLock.unlock()
            let host = hostRaw != 0 ? AVAudioTime.seconds(forHostTime: hostRaw) : FicusAudioSessionPlugin.nowHostSec() - Double(f) / rate
            micScratch.withUnsafeBufferPointer { all in
                appendMic(UnsafeBufferPointer(rebasing: all[0..<f]), sample, host, rate)
            }
        }
    }

    // micQueue の上。塊が micChunkFrames 以上になったら1つ送る。id が空(止めた)・替わった(取り直した)ら、前の溜めは捨てる。
    private func appendMic(_ mono: UnsafeBufferPointer<Float>, _ sample: Double, _ host: Double, _ rate: Double) {
        let id = getMicId()
        if micPendingId != id { micPending.removeAll(keepingCapacity: true) }
        micPendingId = id
        guard !id.isEmpty else { return }
        let expected = micPendingSample + Double(micPending.count)
        if !micPending.isEmpty && (micPendingRate != rate || (sample >= 0 && sample != expected)) {
            // 形式が替わった、または標本が途切れた: 溜めていた分を先に送る(途切れをまたいで1つの塊にしない)
            flushMic()
        }
        if micPending.isEmpty {
            micPendingSample = sample
            micPendingHost = host
            micPendingRate = rate
        }
        micPending.append(contentsOf: mono)
        if micPending.count >= FicusAudioSessionPlugin.micChunkFrames { flushMic() }
    }

    private func flushMic() {
        let n = micPending.count
        guard n > 0, !micPendingId.isEmpty else {
            micPending.removeAll(keepingCapacity: true)
            return
        }
        let data = micPending.withUnsafeBufferPointer { Data(buffer: $0) }
        var sum: Float = 0
        for v in micPending { sum += v * v }
        let db = 20 * log10(Double(sqrt(sum / Float(n))) + 1e-10)
        let now = CFAbsoluteTimeGetCurrent()
        micLock.lock()
        inputLevelDb = db
        micChunks += 1
        if lastFlushAt > 0 {
            sendMsLast = (now - lastFlushAt) * 1000
            sendMsMax = max(sendMsMax, sendMsLast)
        }
        lastFlushAt = now
        micLock.unlock()
        emit("micData", [
            "id": micPendingId,
            "pcm": data.base64EncodedString(),
            "sample": micPendingSample,
            "host": micPendingHost,
            "rate": micPendingRate,
            "frames": n
        ])
        micPending.removeAll(keepingCapacity: true)
    }

    private func getMicId() -> String {
        micLock.lock()
        defer { micLock.unlock() }
        return micId
    }

    private func setMicId(_ id: String) {
        micLock.lock()
        micId = id
        micLock.unlock()
    }

    private func setMicVia(_ via: String) {
        micLock.lock()
        micVia = via
        micLock.unlock()
    }

    private func setInputRate(_ rate: Double) {
        micLock.lock()
        inputRate = rate
        micLock.unlock()
    }

    private func currentInputRate() -> Double {
        micLock.lock()
        defer { micLock.unlock() }
        return inputRate
    }

    private func currentMicCallbacks() -> Int {
        micLock.lock()
        defer { micLock.unlock() }
        return micCallbacks
    }

    // ============================================================
    // メトロノーム
    // ============================================================

    // { sampleRate, accent, beat, sub }(3つは Float32 の標本の base64)。形式(標本化周波数)が替わったらエンジンを作り直す。
    @objc func metroLoad(_ call: CAPPluginCall) {
        guard let rate = FicusAudioSessionPlugin.numberArg(call, "sampleRate"), rate > 0,
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
        audioQueue.async {
            // 今のエンジンのプレーヤーはつないだときの形式のまま。形式が違うバッファを予約すると落ちるので、作り直す
            // (JS はセッションの標本化周波数で描くので、普段は同じ = 作り直さない)
            let formatChanged = self.playerRate != format.sampleRate
            self.clickFormat = format
            self.clickBuffers = loaded
            if formatChanged && self.engine != nil {
                self.teardownEngine()
                if self.micOn || self.metroOn {
                    if let err = self.startEngine() {
                        self.lastError = err
                        self.scheduleRebuild()
                    }
                }
            }
            call.resolve(["frames": loaded.mapValues { Int($0.frameLength) }])
        }
    }

    // { run, v, stepSec, kinds, leadSec }(1小節ぶんの並び)で鳴らし始める。小節の頭を今から leadSec 秒後に置く(Web の startMetronome と同じ 0.12 秒)。
    @objc func metroStart(_ call: CAPPluginCall) {
        let kinds = (call.getArray("kinds") ?? []).compactMap { $0 as? String }
        guard let step = FicusAudioSessionPlugin.numberArg(call, "stepSec"), step > 0, !kinds.isEmpty else {
            call.reject("bad pattern")
            return
        }
        let run = call.getInt("run") ?? 0
        let version = call.getInt("v") ?? 0
        let lead = FicusAudioSessionPlugin.numberArg(call, "leadSec") ?? FicusAudioSessionPlugin.clickLeadSec
        audioQueue.async {
            guard self.clickFormat != nil, !self.clickBuffers.isEmpty else {
                call.reject("not loaded")
                return
            }
            self.metroKinds = kinds
            self.metroStepSec = step
            self.metroVersion = version
            self.metroRun = run
            self.metroIndex = 0
            self.metroTick = 0
            self.metroNextHost = -1
            self.metroLeadSec = lead
            self.metroPending.removeAll()
            self.metroOn = true
            self.rebuildFailures = 0
            self.rebuildTimes.removeAll()
            if let engine = self.engine, engine.isRunning {
                self.startClicks()
            } else {
                self.teardownEngine()
                if let err = self.startEngine() {
                    self.metroOn = false
                    self.lastError = err
                    if self.micOn { self.scheduleRebuild() }
                    call.reject(err)
                    return
                }
            }
            call.resolve(["running": self.engine?.isRunning ?? false])
        }
    }

    // { run, v, stepSec, kinds, restart, leadSec }。テンポ・アクセント・まとまりの変更(restart なし)は、まだ予約していない次の拍から効く
    // (並びの位置と次の時刻はそのまま = Web の metroSchedulerTick が ref を読むのと同じ)。拍子・分割の変更(restart)は小節の頭を今から leadSec 秒後に置き直す
    // (Web の「拍子・分割の変更時は小節の頭から仕切り直す」= currentTime + 0.08)。予約済みのクリックは取り消さない(Web と同じ)。
    @objc func metroUpdate(_ call: CAPPluginCall) {
        let kinds = (call.getArray("kinds") ?? []).compactMap { $0 as? String }
        guard let step = FicusAudioSessionPlugin.numberArg(call, "stepSec"), step > 0, !kinds.isEmpty else {
            call.reject("bad pattern")
            return
        }
        let run = call.getInt("run") ?? 0
        let version = call.getInt("v") ?? 0
        let restart = call.getBool("restart") ?? false
        let lead = FicusAudioSessionPlugin.numberArg(call, "leadSec") ?? FicusAudioSessionPlugin.clickLeadSec
        audioQueue.async {
            guard self.metroOn else {
                call.resolve(["running": false])
                return
            }
            self.metroKinds = kinds
            self.metroStepSec = step
            self.metroVersion = version
            if restart {
                self.metroRun = run
                self.metroIndex = 0
                self.metroTick = 0
                self.metroNextHost = -1
                self.metroLeadSec = lead
                self.metroPending.removeAll()
            } else {
                self.metroIndex = self.metroIndex % kinds.count
            }
            call.resolve(["running": true])
        }
    }

    // { run } で止める。run が今の鳴らし方と違えば何もしない(古い画面の片付けが、新しい START を止めない)。
    // 予約済みのクリック(0.12 秒先まで)は鳴り切る(Web がスケジューラを止めるのと同じ): マイクが止まっていても、エンジンを捨てるのは
    // metroStopTeardownSec(0.25 秒)待ってから。そのときもまだメトロノームもマイクも止まっていれば捨てる。
    @objc func metroStop(_ call: CAPPluginCall) {
        let run = call.getInt("run")
        audioQueue.async {
            if let run = run, run != self.metroRun {
                call.resolve(["stopped": false])
                return
            }
            self.metroOn = false
            self.stopClickTimer()
            if !self.micOn {
                let stopped = self.engine
                self.audioQueue.asyncAfter(deadline: .now() + FicusAudioSessionPlugin.metroStopTeardownSec) { [weak self] in
                    guard let self = self, !self.metroOn, !self.micOn, self.engine === stopped else { return }
                    self.teardownEngine()
                }
            }
            call.resolve(["stopped": true])
        }
    }

    // 時計の対応(JS が拍の時刻と performance.now() を結ぶ)。host = 今の host time(秒)・sampleRate = セッションの出力の標本化周波数(クリックを描く値)。
    // 待たせない(audioQueue に積まない)── 往復の真ん中を host の時刻と見なすので、往復が短いほど合う。
    @objc func audioClock(_ call: CAPPluginCall) {
        call.resolve([
            "host": FicusAudioSessionPlugin.nowHostSec(),
            "sampleRate": AVAudioSession.sharedInstance().sampleRate
        ])
    }

    // 診断の板が1秒ごとに読む(読むだけ)。
    @objc func audioInfo(_ call: CAPPluginCall) {
        audioQueue.async {
            var info: [String: Any] = [
                "engineRunning": self.engine?.isRunning ?? false,
                "activated": self.activated,
                "micOn": self.micOn,
                "metroOn": self.metroOn,
                "configChanges": self.configChanges,
                "rebuilds": self.rebuilds,
                "lastError": self.lastError,
                "scheduled": self.scheduled,
                "played": self.played,
                "playing": self.player?.isPlaying ?? false,
                "lastRender": self.player?.lastRenderTime?.isSampleTimeValid ?? false,
                "tick": self.lastTickReason
            ]
            self.micLock.lock()
            let db = self.inputLevelDb
            info["chunks"] = self.micChunks
            info["inputRate"] = self.inputRate
            info["via"] = self.micVia
            info["cbFrames"] = self.cbFramesLast
            info["cbMax"] = self.cbFramesMax
            info["sendMs"] = self.sendMsLast
            info["sendMaxMs"] = self.sendMsMax
            info["overruns"] = self.micOverruns
            self.micLock.unlock()
            if let db = db { info["inputDb"] = db }
            call.resolve(info)
        }
    }

    // ============================================================
    // エンジン(audioQueue の上だけで触る)
    // ============================================================

    // 音のセッションを用意する: 種別・モード・選択肢が違えば setCategory → I/O の長さの希望 → setActive(true) → 入力は本体のマイク → 受話口ならスピーカーへ。
    private func configureSession() -> String? {
        let session = AVAudioSession.sharedInstance()
        do {
            if needsSessionReset(session) {
                try session.setCategory(.playAndRecord, mode: FicusAudioSessionPlugin.sessionMode, options: FicusAudioSessionPlugin.sessionOptions)
            }
            try? session.setPreferredIOBufferDuration(FicusAudioSessionPlugin.preferredIOBufferSec)
            try session.setActive(true)
            activated = true
        } catch {
            return "session: \(error.localizedDescription)"
        }
        applyInputRule(session)
        do {
            try applyOutputRule(session)
        } catch {
            lastError = "output: \(error.localizedDescription)"
        }
        return nil
    }

    // エンジン(プレーヤー → mainMixer。マイクが要れば入力も)を作って始める。鳴らしていれば予約を始める。失敗の文を返す(エンジンは捨てる)。
    // sink のエンジンが始まらなければ、installTap に戻して1回だけ作り直す。sink の受け手が sinkCheckSec 来なければ、そのときも installTap に戻す。
    private func startEngine() -> String? {
        if let err = configureSession() { return err }
        let engine = AVAudioEngine()
        let player = AVAudioPlayerNode()
        engine.attach(player)
        // クリックをまだ受け取っていなければ、セッションの標本化周波数のモノラルでつなぐ(JS もこの値で描くので、後から受け取っても作り直さない)
        let playerFormat = clickFormat ?? AVAudioFormat(standardFormatWithSampleRate: AVAudioSession.sharedInstance().sampleRate, channels: 1)
        engine.connect(player, to: engine.mainMixerNode, format: playerFormat)
        playerRate = playerFormat?.sampleRate ?? 0
        self.engine = engine
        self.player = player
        engineHasInput = false
        tapInstalled = false
        sinkNode = nil
        if micOn {
            if let err = installMicInput(engine) {
                teardownEngine()
                return err
            }
        }
        NotificationCenter.default.addObserver(self,
                                               selector: #selector(handleEngineConfigChange(_:)),
                                               name: .AVAudioEngineConfigurationChange,
                                               object: engine)
        engine.prepare()
        do {
            try engine.start()
            activated = true
        } catch {
            let usedSink = sinkNode != nil
            teardownEngine()
            if usedSink && !sinkUnavailable {
                sinkUnavailable = true
                lastError = "sink: start failed"
                return startEngine()
            }
            return "start: \(error.localizedDescription)"
        }
        if sinkNode != nil {
            let started = engine
            let before = currentMicCallbacks()
            audioQueue.asyncAfter(deadline: .now() + FicusAudioSessionPlugin.sinkCheckSec) { [weak self] in
                guard let self = self, self.engine === started, self.sinkNode != nil, started.isRunning, self.micOn else { return }
                if self.currentMicCallbacks() == before {
                    self.sinkUnavailable = true
                    self.lastError = "sink: no data"
                    self.teardownEngine()
                    if let err = self.startEngine() {
                        self.lastError = err
                        self.scheduleRebuild()
                    }
                }
            }
        }
        if metroOn { startClicks() }
        return nil
    }

    // 予約の時計を始める(並びの位置と次の時刻はそのまま)。プレーヤーの play() はエンジンが動いているときだけ(動いていないエンジンのプレーヤーに呼ぶと例外で落ちる)。
    private func startClicks() {
        stopClickTimer()
        metroEpoch += 1
        noRenderTicks = 0
        lastTickReason = "idle"
        guard metroOn, let player = player else { return }
        guard let engine = engine, engine.isRunning else {
            lastError = "engine not running"
            return
        }
        if !player.isPlaying { player.play() }
        let timer = DispatchSource.makeTimerSource(queue: audioQueue)
        timer.schedule(deadline: .now(), repeating: .milliseconds(FicusAudioSessionPlugin.clickTimerMs))
        timer.setEventHandler { [weak self] in self?.clickTick() }
        clickTimer = timer
        timer.resume()
    }

    private func stopClickTimer() {
        clickTimer?.cancel()
        clickTimer = nil
    }

    // 予約の時計・プレーヤー・入力・エンジンを片付ける(micOn / metroOn はそのまま)。
    // 拍の格子を続けるため、予約したがまだ来ていないクリックがあれば、その最初のものから予約し直す(次のエンジンで同じ host time・同じ通し番号で予約する。
    // JS は同じ番号の知らせを捨てる)。
    private func teardownEngine() {
        stopClickTimer()
        metroEpoch += 1
        let now = FicusAudioSessionPlugin.nowHostSec()
        if let first = metroPending.first(where: { $0.host > now }) {
            metroNextHost = first.host
            metroIndex = first.index
            metroTick = first.tick
        }
        metroPending.removeAll()
        if let engine = engine {
            NotificationCenter.default.removeObserver(self, name: .AVAudioEngineConfigurationChange, object: engine)
            player?.stop()
            if tapInstalled { engine.inputNode.removeTap(onBus: 0) }
            engine.stop()
        }
        tapInstalled = false
        engineHasInput = false
        sinkNode = nil
        setMicVia("none")
        engine = nil
        player = nil
    }

    // 25ms ごと(audioQueue)。host time で 0.12 秒先までのクリックを数え、プレーヤーの sample time に直して予約する。
    // 過ぎてしまった拍(作り直しの間など)は鳴らさずに格子の上で数だけ進める(gridSkip。並びの次の拍の host time を引き継ぐ)。
    // 早く返った理由は lastTickReason に残す(板の tick): idle / noEngine / notRunning / noPlayer / replay / noRender / noPlayerTime / badRate / ok。
    private func clickTick() {
        guard metroOn, !metroKinds.isEmpty, metroStepSec > 0 else { lastTickReason = "idle"; return }
        guard let engine = engine else { lastTickReason = "noEngine"; return }
        guard engine.isRunning else { lastTickReason = "notRunning"; return }
        guard let player = player else { lastTickReason = "noPlayer"; return }
        if !player.isPlaying {
            // エンジンは動いているのにプレーヤーが止まっている(中断のあと等)。play の直前でもう一度エンジンを確かめてから再開する
            guard engine.isRunning else { lastTickReason = "notRunning"; return }
            player.play()
            noRenderTicks = 0
            lastTickReason = "replay"
            return
        }
        guard let nodeTime = player.lastRenderTime, nodeTime.isSampleTimeValid, nodeTime.isHostTimeValid else { noteNoRender("noRender"); return }
        guard let playerTime = player.playerTime(forNodeTime: nodeTime), playerTime.isSampleTimeValid else { noteNoRender("noPlayerTime"); return }
        guard playerTime.sampleRate > 0 else { lastTickReason = "badRate"; return }
        noRenderTicks = 0
        let rate = playerTime.sampleRate
        let nowSample = Double(playerTime.sampleTime)
        let nowHost = AVAudioTime.seconds(forHostTime: nodeTime.hostTime)
        let ahead = FicusAudioSessionPlugin.clickLookaheadSec
        metroPending.removeAll(where: { $0.host < nowHost })
        var clicks: [[String: Any]] = []
        if metroNextHost < 0 {
            metroNextHost = nowHost + metroLeadSec
        } else if metroNextHost < nowHost {
            let skip = min(FicusAudioSessionPlugin.gridSkip(next: metroNextHost, now: nowHost, step: metroStepSec), FicusAudioSessionPlugin.clickMaxPerTick)
            for _ in 0..<skip {
                let index = metroIndex % metroKinds.count
                if metroKinds[index] != "silent" {
                    clicks.append(["h": metroNextHost, "s": -1, "k": "skipped", "i": index, "v": metroVersion, "n": metroTick])
                }
                metroTick += 1
                metroIndex = (index + 1) % metroKinds.count
                metroNextHost += metroStepSec
            }
            if metroNextHost < nowHost { metroNextHost = nowHost + ahead }
        }
        var count = 0
        while metroNextHost < nowHost + ahead && count < FicusAudioSessionPlugin.clickMaxPerTick {
            count += 1
            let index = metroIndex % metroKinds.count
            let kind = metroKinds[index]
            if let buffer = clickBuffers[kind] {
                let sampleAt = (nowSample + (metroNextHost - nowHost) * rate).rounded()
                let epoch = metroEpoch
                player.scheduleBuffer(buffer,
                                      at: AVAudioTime(sampleTime: AVAudioFramePosition(sampleAt), atRate: rate),
                                      options: [],
                                      completionCallbackType: .dataPlayedBack) { [weak self] _ in
                    self?.noteClickPlayed(epoch)
                }
                scheduled += 1
                metroPending.append((host: metroNextHost, index: index, tick: metroTick))
                clicks.append(["h": metroNextHost, "s": sampleAt, "k": kind, "i": index, "v": metroVersion, "n": metroTick])
            }
            metroTick += 1
            metroIndex = (index + 1) % metroKinds.count
            metroNextHost += metroStepSec
        }
        lastTickReason = "ok"
        if !clicks.isEmpty {
            emit("metroClicks", ["run": metroRun, "clicks": clicks])
        }
    }

    // 再生し終わったクリックを数える(完了の通知は音のスレッドから来るので audioQueue へ回す)。止めた・作り直した後の通知(epoch が古い)は数えない。
    private func noteClickPlayed(_ epoch: Int) {
        audioQueue.async { [weak self] in
            guard let self = self, epoch == self.metroEpoch else { return }
            self.played += 1
        }
    }

    // プレーヤーの時計が有効でない tick。続いたら(primeAfterTicks)、無音の短いバッファを1つ at: nil で予約して時計を動かす(1回だけ。音は出ない)。
    private func noteNoRender(_ reason: String) {
        lastTickReason = reason
        noRenderTicks += 1
        if noRenderTicks == FicusAudioSessionPlugin.primeAfterTicks, let player = player, let buffer = silentPrimeBuffer() {
            player.scheduleBuffer(buffer, at: nil, options: [], completionHandler: nil)
            lastTickReason = reason + "+primed"
        }
    }

    // 無音(0)のバッファ。AVAudioPCMBuffer の中身は 0 とは限らないので、明示的に 0 にする。
    private func silentPrimeBuffer() -> AVAudioPCMBuffer? {
        let frames = FicusAudioSessionPlugin.primeFrames
        guard let format = clickFormat,
              let buffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: frames),
              let dst = buffer.floatChannelData?[0] else { return nil }
        memset(dst, 0, Int(frames) * MemoryLayout<Float>.size)
        buffer.frameLength = frames
        return buffer
    }

    // ============================================================
    // 作り直し・中断・経路
    // ============================================================

    // 過ぎてしまった拍の数(格子を保つ)。純関数。JS の nativeGridSkip(src/shell/nativeAudio.js)と同じ式(pitch-test K.14 が突き合わせる)。
    static func gridSkip(next: Double, now: Double, step: Double) -> Int {
        return now > next ? Int(((now - next) / step).rounded(.up)) : 0
    }

    // 作り直しの遅れ(1 秒に 1 回まで・通知から 0.2 秒は待つ)。純関数。JS の nativeRebuildDelay と同じ式。
    static func rebuildDelay(sinceLast: Double) -> Double {
        return max(rebuildSettleSec, rebuildMinIntervalSec - sinceLast)
    }

    // 作り直しの歯止め(10 秒に 5 回まで)。純関数(時刻を差し替えられる)。窓の中に残る時刻と、諦めるか。JS の nativeRebuildDecision と同じ式。
    static func rebuildDecision(_ times: [Double], now: Double) -> (keep: [Double], giveUp: Bool) {
        let keep = times.filter { now - $0 < rebuildWindowSec }
        return (keep, keep.count >= rebuildMaxInWindow)
    }

    // エンジンの構成が変わった(経路の変化・形式の変化など)。エンジンは止まっているので捨て、回数と理由を控えて作り直す。
    @objc func handleEngineConfigChange(_ notification: Notification) {
        audioQueue.async {
            guard let changed = notification.object as? AVAudioEngine, changed === self.engine else { return }
            self.configChanges += 1
            self.lastError = "configurationChange"
            self.teardownEngine()
            self.scheduleRebuild()
        }
    }

    // 中断(電話・Siri など)。始まったときは控えて JS に知らせるだけ、終わったとき(.ended)は、動いていたものがあれば捨てて作り直す。
    @objc func handleInterruption(_ notification: Notification) {
        guard let raw = notification.userInfo?[AVAudioSessionInterruptionTypeKey] as? UInt,
              let type = AVAudioSession.InterruptionType(rawValue: raw) else { return }
        audioQueue.async {
            if type == .began {
                self.lastError = "interruption began"
                if self.micOn || self.metroOn { self.notifyState("interrupted", "began") }
                return
            }
            guard self.micOn || self.metroOn else { return }
            self.configChanges += 1
            self.lastError = "interruption ended"
            self.rebuildFailures = 0 // 前の失敗の数を引き継がない(中断が終わったので、また 5 回まで試す)
            self.teardownEngine()
            self.scheduleRebuild()
        }
    }

    // メディアサービスのリセット。エンジンは使えなくなるので捨てて作り直す。
    @objc func handleMediaServicesReset(_ notification: Notification) {
        audioQueue.async {
            guard self.micOn || self.metroOn else { return }
            self.configChanges += 1
            self.lastError = "mediaServicesReset"
            self.teardownEngine()
            self.scheduleRebuild()
        }
    }

    // 作り直しの予約(audioQueue の上で呼ぶ)。1 つだけ持つ・遅れは rebuildDelay = 連続は 1 秒に 1 回まで。
    // 時が来たとき、止められていた(micOn も metroOn も偽)・もう動いているエンジンがあるなら何もしない。失敗は rebuildMaxFailures 回まで続け、
    // 10 秒に 5 回に達したら諦める(rebuildDecision。作り直しに成功しても構成の変化が飛び続ける嵐の歯止め)。諦めたら JS へ failed を知らせる。
    private func scheduleRebuild() {
        guard micOn || metroOn, !rebuildScheduled else { return }
        rebuildScheduled = true
        let delay = FicusAudioSessionPlugin.rebuildDelay(sinceLast: CFAbsoluteTimeGetCurrent() - lastRebuildAt)
        audioQueue.asyncAfter(deadline: .now() + delay) { [weak self] in
            guard let self = self else { return }
            self.rebuildScheduled = false
            guard self.micOn || self.metroOn else { return }
            if let engine = self.engine, engine.isRunning { return }
            let nowTime = CFAbsoluteTimeGetCurrent()
            let decision = FicusAudioSessionPlugin.rebuildDecision(self.rebuildTimes, now: nowTime)
            self.rebuildTimes = decision.keep
            if decision.giveUp {
                self.lastError = "rebuild: loop"
                self.giveUp("loop")
                return
            }
            self.rebuildTimes.append(nowTime)
            self.lastRebuildAt = nowTime
            self.teardownEngine()
            if let err = self.startEngine() {
                self.rebuildFailures += 1
                self.lastError = "rebuild: \(err)"
                if self.rebuildFailures < FicusAudioSessionPlugin.rebuildMaxFailures {
                    self.scheduleRebuild()
                } else {
                    self.giveUp(err)
                }
            } else {
                self.rebuildFailures = 0
                self.rebuilds += 1
                self.notifyState("running", "rebuilt")
            }
        }
    }

    // 作り直しを諦める: JS へ failed を知らせ(マイクは既存の復旧の入口で取り直す・メトロノームは止める)、エンジンを捨てる。
    // JS が micStart / metroStart を呼べば、回数は数え直して始め直す。
    private func giveUp(_ reason: String) {
        let mic = micOn
        let metro = metroOn
        let id = getMicId()
        let run = metroRun
        micOn = false
        metroOn = false
        setMicId("")
        teardownEngine()
        emit("audioState", ["state": "failed", "reason": reason, "mic": mic, "metro": metro, "id": id, "run": run])
    }

    private func notifyState(_ state: String, _ reason: String) {
        emit("audioState", ["state": state, "reason": reason, "mic": micOn, "metro": metroOn, "id": getMicId(), "run": metroRun])
    }

    // 裏へ行った: クリックも取り込みも止める(戻っても勝手に鳴らさない。JS は戻ったときに既存の道でマイクを取り直す)。
    @objc func handleDidEnterBackground(_ notification: Notification) {
        audioQueue.async {
            self.micOn = false
            self.metroOn = false
            self.setMicId("")
            self.metroPending.removeAll()
            self.teardownEngine()
        }
    }

    // 経路の変化(イヤホンの抜き差し・Bluetooth の接続と切断)。殻の音が動いている間(micOn / metroOn)だけ、同じ規則を当て直す。
    // 【便CX】WebKit はもう音のセッションを立て直さないので、ここは「殻のセッションが別の何かに替えられていたら戻す」念のための当て直しと、入力・出口の規則。
    @objc func handleRouteChange(_ notification: Notification) {
        audioQueue.async {
            let session = AVAudioSession.sharedInstance()
            guard self.micOn || self.metroOn, session.category == .playAndRecord else {
                self.clearInputRuleTriedRoutes()
                return
            }
            do {
                if self.needsSessionReset(session) {
                    try session.setCategory(.playAndRecord, mode: FicusAudioSessionPlugin.sessionMode, options: FicusAudioSessionPlugin.sessionOptions)
                }
                self.applyInputRule(session)
                try self.applyOutputRule(session)
            } catch {
                CAPLog.print("FicusAudioSession: route change: \(error.localizedDescription)")
            }
        }
    }

    // 立て直すかの判断。種別・モード(.default)・選択肢の3つ。configureSession(エンジンを始める前)と経路の変化の両方が使う。
    func needsSessionReset(_ session: AVAudioSession) -> Bool {
        return session.category != .playAndRecord
            || session.mode != FicusAudioSessionPlugin.sessionMode
            || session.categoryOptions != FicusAudioSessionPlugin.sessionOptions
    }

    // 【便CS】入力の規則: 入力はいつも本体のマイク(builtInMic)。Bluetooth のイヤホン(HFP)・有線のヘッドセットのマイクは使わない(計測の質のため)。
    // 呼ぶのは configureSession と経路の変化。入力も優先も本体のマイクなら何もしない。同じ経路では1回しか呼ばない(上の inputRuleTriedRoutes)。
    // 本体のマイクが一覧に無いときも何もしない。失敗は記録だけ(出口の規則は続けて当てる)。
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
    // defaultToSpeaker があるので普段は受話口に出ない(念のための規則)。
    func applyOutputRule(_ session: AVAudioSession) throws {
        let outputs = session.currentRoute.outputs.map { $0.portType }
        if outputs.contains(.builtInReceiver) {
            try session.overrideOutputAudioPort(.speaker)
        }
    }

    // 今の host time(秒)。マイクの塊の host・クリックの h と同じ時計(mach の時計)。
    static func nowHostSec() -> Double {
        return AVAudioTime.seconds(forHostTime: mach_absolute_time())
    }

    // 【便CV】JS の数値(48000 のような整数も 0.5 のような小数も)を Double で読む。getDouble が整数を拾わない場合に getInt へ落ちる。
    static func numberArg(_ call: CAPPluginCall, _ key: String) -> Double? {
        if let d = call.getDouble(key) { return d }
        if let i = call.getInt(key) { return Double(i) }
        return nil
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
