#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use tauri::{WebviewUrl, WebviewWindowBuilder};

const SERVICE_URL: &str = include_str!("../../../web/SERVICE_URL");
const APP_VERSION: &str = include_str!("../../../web/VERSION");

fn desktop_url() -> String {
    let configured = std::env::var("BEATDASH_DESKTOP_URL").ok();
    let base = configured.as_deref().unwrap_or(SERVICE_URL).trim().trim_end_matches('/');
    let version = APP_VERSION.trim();
    format!("{base}/?platform=desktop&desktopVersion={version}")
}

fn main() {
    tauri::Builder::default()
        .setup(|app| {
            let url = desktop_url()
                .parse()
                .expect("web/SERVICE_URL must be a valid URL");
            WebviewWindowBuilder::new(app, "main", WebviewUrl::External(url))
                .title("BEATDASH")
                .inner_size(1280.0, 800.0)
                .min_inner_size(960.0, 600.0)
                .resizable(true)
                .build()?;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running BEATDASH Desktop");
}
