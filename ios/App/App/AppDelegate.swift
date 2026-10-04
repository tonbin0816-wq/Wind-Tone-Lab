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
// 【殻 S1/S2】Ficus のネイティブ側。新しい .swift を足さず(project.pbxproj を触らないため)ここに置く。
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
// Bluetooth は許可しない(マイクが替わる・遅延)。有線は挿せばそちらへ出る。
@objc(FicusAudioSessionPlugin)
public class FicusAudioSessionPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "FicusAudioSessionPlugin"
    public let jsName = "FicusAudioSession"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "routeToSpeaker", returnType: CAPPluginReturnPromise)
    ]

    @objc func routeToSpeaker(_ call: CAPPluginCall) {
        let session = AVAudioSession.sharedInstance()
        do {
            try session.setCategory(.playAndRecord, mode: .default, options: [.defaultToSpeaker])
            try session.overrideOutputAudioPort(.speaker)
            call.resolve([
                "category": session.category.rawValue,
                "outputs": session.currentRoute.outputs.map { $0.portType.rawValue }
            ])
        } catch {
            call.reject("audio session: \(error.localizedDescription)")
        }
    }
}
