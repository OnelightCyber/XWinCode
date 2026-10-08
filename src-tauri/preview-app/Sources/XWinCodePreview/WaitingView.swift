import SwiftUI

struct WaitingView: View {
    let connected: Bool
    let problem: String?
    var paired = false
    var wifiReady = false
    var unpair: () -> Void = {}

    var body: some View {
        VStack(spacing: 0) {
            Spacer(minLength: 24)
            VStack(spacing: 22) {
                Image(systemName: "laptopcomputer.and.iphone")
                    .font(.system(size: 44, weight: .thin))
                    .foregroundStyle(.secondary)
                    .symbolEffect(.pulse, isActive: !connected)
                VStack(spacing: 8) {
                    Text(verbatim: "XWinCode Preview")
                        .font(.title2.weight(.semibold))
                        .foregroundStyle(.primary)
                    Text(verbatim: "Waiting for XWinCode…")
                        .font(.body)
                        .foregroundStyle(.secondary)
                }
                if connected {
                    HStack(spacing: 6) {
                        Circle()
                            .frame(width: 6, height: 6)
                        Text(verbatim: "Connected")
                            .font(.caption)
                    }
                    .foregroundStyle(.secondary)
                    .transition(.opacity)
                }
            }
            Spacer(minLength: 24)
            Text(verbatim: "Plug the iPhone into your PC, then open the Canvas in XWinCode and choose Live on iPhone.")
                .font(.footnote)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
                .frame(maxWidth: 320)
                .padding(.bottom, paired || problem != nil ? 10 : 28)
            if paired {
                HStack(spacing: 6) {
                    Image(systemName: wifiReady ? "wifi" : "wifi.slash")
                    Text(verbatim: wifiReady ? "Paired: Live also works over Wi-Fi" : "Paired with your PC")
                    Button("Unpair", role: .destructive, action: unpair)
                        .font(.footnote)
                }
                .font(.footnote)
                .foregroundStyle(.secondary)
                .padding(.bottom, problem == nil ? 28 : 10)
            }
            if let problem {
                Text(verbatim: "Can't listen on port 7878: \(problem)")
                    .font(.caption2.monospaced())
                    .foregroundStyle(.red)
                    .multilineTextAlignment(.center)
                    .frame(maxWidth: 320)
                    .padding(.bottom, 24)
            }
        }
        .padding(.horizontal, 32)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Color(uiColor: .systemBackground))
        .animation(.easeInOut(duration: 0.25), value: connected)
    }
}
