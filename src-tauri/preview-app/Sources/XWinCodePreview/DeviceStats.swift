import Darwin
import Foundation
import QuartzCore
import UIKit

@MainActor
final class DeviceStats: NSObject {
    private let emit: (String) -> Void
    private var link: CADisplayLink?
    private var timer: Timer?
    private var frames = 0
    private var since: CFTimeInterval = 0

    init(emit: @escaping (String) -> Void) {
        self.emit = emit
        super.init()
    }

    func start() {
        stop()
        UIDevice.current.isBatteryMonitoringEnabled = true
        frames = 0
        since = CACurrentMediaTime()
        let rate = Float(Self.maxFps)
        let link = CADisplayLink(target: self, selector: #selector(tick))
        link.preferredFrameRateRange = CAFrameRateRange(minimum: min(30, rate), maximum: rate, preferred: rate)
        link.add(to: .main, forMode: .common)
        self.link = link
        let timer = Timer(timeInterval: 1, repeats: true) { [weak self] _ in
            MainActor.assumeIsolated {
                self?.report()
            }
        }
        RunLoop.main.add(timer, forMode: .common)
        self.timer = timer
    }

    func stop() {
        link?.invalidate()
        link = nil
        timer?.invalidate()
        timer = nil
        UIDevice.current.isBatteryMonitoringEnabled = false
    }

    @objc private func tick() {
        frames += 1
    }

    private func report() {
        let now = CACurrentMediaTime()
        let elapsed = max(now - since, 0.001)
        let fps = Int((Double(frames) / elapsed).rounded())
        frames = 0
        since = now
        let level = UIDevice.current.batteryLevel
        emit(JSONValue.message([
            ("type", .string("stats")),
            ("fps", .number(Double(fps))),
            ("maxFps", .number(Double(Self.maxFps))),
            ("memoryMB", .number(Self.rounded(Self.memoryMB(), places: 1))),
            ("cpu", .number(Self.rounded(Self.cpuPercent(), places: 1))),
            ("thermal", .string(Self.thermal)),
            ("lowPower", .bool(ProcessInfo.processInfo.isLowPowerModeEnabled)),
            ("battery", .number(level < 0 ? -1 : Self.rounded(Double(level), places: 2))),
        ]))
    }

    static var screen: UIScreen? {
        let scenes = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
        return (scenes.first { $0.activationState == .foregroundActive } ?? scenes.first)?.screen
    }

    static var maxFps: Int {
        max(screen?.maximumFramesPerSecond ?? 60, 1)
    }

    static let machine: String = {
        var info = utsname()
        uname(&info)
        return withUnsafeBytes(of: info.machine) { raw in
            String(decoding: raw.prefix { $0 != 0 }, as: UTF8.self)
        }
    }()

    static var thermal: String {
        switch ProcessInfo.processInfo.thermalState {
        case .nominal: return "nominal"
        case .fair: return "fair"
        case .serious: return "serious"
        case .critical: return "critical"
        @unknown default: return "nominal"
        }
    }

    static func memoryMB() -> Double {
        var info = task_vm_info_data_t()
        var count = mach_msg_type_number_t(MemoryLayout<task_vm_info_data_t>.size / MemoryLayout<integer_t>.size)
        let result = withUnsafeMutablePointer(to: &info) { pointer in
            pointer.withMemoryRebound(to: integer_t.self, capacity: Int(count)) { raw in
                task_info(mach_task_self_, task_flavor_t(TASK_VM_INFO), raw, &count)
            }
        }
        guard result == KERN_SUCCESS else { return 0 }
        return Double(info.phys_footprint) / 1_048_576
    }

    static func cpuPercent() -> Double {
        var threads: thread_act_array_t?
        var count = mach_msg_type_number_t(0)
        guard task_threads(mach_task_self_, &threads, &count) == KERN_SUCCESS, let threads else { return 0 }
        defer {
            for index in 0..<Int(count) {
                mach_port_deallocate(mach_task_self_, threads[index])
            }
            let size = vm_size_t(Int(count) * MemoryLayout<thread_t>.stride)
            vm_deallocate(mach_task_self_, vm_address_t(UInt(bitPattern: threads)), size)
        }
        var total = 0.0
        for index in 0..<Int(count) {
            var info = thread_basic_info()
            var infoCount = mach_msg_type_number_t(MemoryLayout<thread_basic_info>.size / MemoryLayout<integer_t>.size)
            let result = withUnsafeMutablePointer(to: &info) { pointer in
                pointer.withMemoryRebound(to: integer_t.self, capacity: Int(infoCount)) { raw in
                    thread_info(threads[index], thread_flavor_t(THREAD_BASIC_INFO), raw, &infoCount)
                }
            }
            guard result == KERN_SUCCESS, info.flags & TH_FLAGS_IDLE == 0 else { continue }
            total += Double(info.cpu_usage) / Double(TH_USAGE_SCALE) * 100
        }
        return total
    }

    static func rounded(_ value: Double, places: Int) -> Double {
        let factor = pow(10, Double(places))
        return (value * factor).rounded() / factor
    }
}
