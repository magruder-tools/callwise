// swift-tools-version: 6.0
import PackageDescription
import Foundation
let infoPlist = URL(fileURLWithPath: #filePath).deletingLastPathComponent().appendingPathComponent("Info.plist").path
let package = Package(
    name: "CallwiseNative",
    platforms: [.macOS("26.0")],
    products: [.executable(name: "callwise-native", targets: ["CallwiseNative"])],
    dependencies: [.package(url: "https://github.com/FluidInference/FluidAudio.git", exact: "0.12.4")],
    targets: [.executableTarget(name: "CallwiseNative", dependencies: [.product(name: "FluidAudio", package: "FluidAudio")], linkerSettings: [.unsafeFlags(["-Xlinker", "-sectcreate", "-Xlinker", "__TEXT", "-Xlinker", "__info_plist", "-Xlinker", infoPlist])])],
    swiftLanguageModes: [.v5]
)
