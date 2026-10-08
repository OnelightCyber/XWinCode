// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "XWinCodePreview",
    platforms: [
        .iOS(.v17),
    ],
    products: [
        .library(
            name: "XWinCodePreview",
            targets: ["XWinCodePreview"]
        ),
    ],
    targets: [
        .target(
            name: "XWinCodePreview"
        ),
    ],
    swiftLanguageModes: [.v5]
)
