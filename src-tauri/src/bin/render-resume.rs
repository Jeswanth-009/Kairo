//! Dev tool: renders a stored plan JSON to LaTeX.
//! Usage: cargo run --bin render-resume -- <plan.json> [out.tex] [template]
//! Template is one of "jake" | "expressive" | "plushcv" (default: jake).
//! The plan JSON is exactly what `resume_plans.plan_json` stores.

use kairo_lib::composer::ResumePlan;
use std::path::PathBuf;

fn main() {
    let args: Vec<String> = std::env::args().collect();
    if args.len() < 2 {
        eprintln!("usage: render-resume <plan.json> [out.tex] [jake|expressive|plushcv]");
        std::process::exit(2);
    }
    let plan_json = std::fs::read_to_string(&args[1]).expect("read plan json");
    let plan: ResumePlan = serde_json::from_str(&plan_json).expect("parse plan json");
    let template = args.get(3).map(String::as_str).unwrap_or("jake");
    let tex = kairo_lib::latex::render_plan(&plan, template);
    let out = if args.len() > 2 {
        PathBuf::from(&args[2])
    } else {
        PathBuf::from("resume.tex")
    };
    std::fs::write(&out, tex).expect("write tex");
    println!("wrote {}", out.display());
}
