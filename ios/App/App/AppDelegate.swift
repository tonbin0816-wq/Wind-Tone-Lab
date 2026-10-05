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
// イヤホンをつなぐ・外す(経路の変化)たびに同じ規則を当て直す。外したとき(OldDeviceUnavailable)は WebKit が
// AudioContext を一度止めるので、メトロノームは JS 側(App.jsx の onstatechange)で再開する(実機で確かめる)。
@objc(FicusAudioSessionPlugin)
public class FicusAudioSessionPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "FicusAudioSessionPlugin"
    public let jsName = "FicusAudioSession"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "routeToSpeaker", returnType: CAPPluginReturnPromise)
    ]

    // 殻の音のセッションの選択肢(値の唯一の答え)。
    static let sessionOptions: AVAudioSession.CategoryOptions = [.defaultToSpeaker, .allowBluetoothA2DP]

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
            // 選択肢が既に同じなら立て直さない(取り込み中・再生中の経路を無駄に揺らさない)
            if session.category != .playAndRecord || session.categoryOptions != FicusAudioSessionPlugin.sessionOptions {
                try session.setCategory(.playAndRecord, mode: .default, options: FicusAudioSessionPlugin.sessionOptions)
            }
            try applyOutputRule(session)
            call.resolve([
                "category": session.category.rawValue,
                "outputs": session.currentRoute.outputs.map { $0.portType.rawValue }
            ])
        } catch {
            call.reject("audio session: \(error.localizedDescription)")
        }
    }

    // 経路の変化(イヤホンの抜き差し・Bluetooth の接続と切断・WebKit による種別の立て直し)。
    // 通知は裏のスレッドで来るので main へ回す。当て直すのは「取り込み中(playAndRecord)」のときだけで、
    // WebKit が再生だけの種別(playback など。受話口へは回らない)にしている間は触らない。
    @objc func handleRouteChange(_ notification: Notification) {
        DispatchQueue.main.async {
            let session = AVAudioSession.sharedInstance()
            guard session.category == .playAndRecord else { return }
            do {
                if session.categoryOptions != FicusAudioSessionPlugin.sessionOptions {
                    try session.setCategory(.playAndRecord, mode: .default, options: FicusAudioSessionPlugin.sessionOptions)
                }
                try self.applyOutputRule(session)
            } catch {
                CAPLog.print("FicusAudioSession: route change: \(error.localizedDescription)")
            }
        }
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
