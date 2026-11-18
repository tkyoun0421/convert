use std::env;
use std::path::Path;

fn main() {
    println!(
        "cargo:rustc-env=TARGET_TRIPLE={}",
        env::var("TARGET").expect("cargo sets TARGET for build scripts")
    );

    let mut attributes = tauri_build::Attributes::new();
    if env::var("CARGO_CFG_TARGET_ENV").as_deref() == Ok("msvc") {
        // tauri-build links its manifest into the app binary only. Test binaries then load
        // Common Controls v5, which lacks TaskDialogIndirect (used by the dialog plugin), and
        // exit with STATUS_ENTRYPOINT_NOT_FOUND. Embedding it through the linker covers every target.
        attributes = attributes
            .windows_attributes(tauri_build::WindowsAttributes::new_without_app_manifest());
        let manifest =
            Path::new(&env::var("CARGO_MANIFEST_DIR").unwrap()).join("windows-app-manifest.xml");
        println!("cargo:rerun-if-changed={}", manifest.display());
        println!("cargo:rustc-link-arg=/MANIFEST:EMBED");
        println!("cargo:rustc-link-arg=/MANIFESTINPUT:{}", manifest.display());
    }
    tauri_build::try_build(attributes).expect("tauri-build failed");
}
