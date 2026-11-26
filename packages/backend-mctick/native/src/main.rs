//! redstack-mctick: runs a structure in mc-tick and reports what a test needs.
//!
//! stdin: one JSON request (see `Request`), stdout: one JSON response.
//! The structure is gametest-flavoured SNBT with its lowest corner at 0,0,0;
//! the caller translates coordinates.

use std::collections::BTreeMap;
use std::io::Read;
use std::time::Instant;

use mc_test::mc_tick::{Pos, Simulation, Structure};
use mc_test::{try_build_sim, SettleMode};
use serde::{Deserialize, Serialize};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Request {
    snbt: String,
    /// "placement": settle like a freshly built structure; "in-world": exactly as given
    settle: String,
    data_version: Option<i32>,
    random_tick_speed: Option<u8>,
    seed: Option<i64>,
    actions: Vec<Action>,
    duration_ticks: u64,
    sample_every: u64,
    containers: Vec<[i32; 3]>,
    items: Vec<String>,
}

#[derive(Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
enum Action {
    Use { at: [i32; 3] },
    Wait { ticks: u64 },
}

#[derive(Serialize)]
struct Sample {
    tick: u64,
    stored: BTreeMap<String, u64>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Response {
    ok: bool,
    error: Option<String>,
    samples: Vec<Sample>,
    ground_items: Vec<GroundItem>,
    ms_per_tick: Option<f64>,
}

#[derive(Serialize)]
struct GroundItem {
    item: String,
    count: u8,
    pos: [f64; 3],
}

/// Counts items in containers; a shulker box item counts itself and its contents.
fn count(sim: &Simulation, containers: &[[i32; 3]], items: &[String]) -> BTreeMap<String, u64> {
    let mut out: BTreeMap<String, u64> = items.iter().map(|i| (i.clone(), 0)).collect();
    let mut all = 0u64;
    fn add(stack: &mc_test::mc_tick::ItemStack, out: &mut BTreeMap<String, u64>, all: &mut u64) {
        *all += stack.count as u64;
        if let Some(v) = out.get_mut(&stack.id) {
            *v += stack.count as u64;
        }
        if let Some(inner) = &stack.contents {
            for s in inner {
                add(s, out, all);
            }
        }
    }
    for p in containers {
        if let Some(inv) = sim.inventory(Pos::new(p[0], p[1], p[2])) {
            for s in &inv.stacks {
                add(s, &mut out, &mut all);
            }
        }
    }
    out.insert("*".into(), all);
    out
}

fn run(req: Request) -> Result<Response, String> {
    let structure = Structure::parse(&req.snbt).map_err(|e| format!("structure: {e:?}"))?;
    let settle = match req.settle.as_str() {
        "placement" => SettleMode::Placement,
        "in-world" => SettleMode::InWorld,
        other => return Err(format!("unknown settle mode {other}")),
    };
    let mut sim = try_build_sim(&structure, Pos::new(0, 0, 0), settle, &[], &[], req.data_version, "redstack")?;
    if let Some(speed) = req.random_tick_speed {
        sim.set_random_ticks(speed);
    }
    if let Some(seed) = req.seed {
        sim.set_rng_seed(seed);
    }
    for a in &req.actions {
        match a {
            Action::Use { at } => sim.use_block(Pos::new(at[0], at[1], at[2])),
            Action::Wait { ticks } => {
                sim.run(*ticks);
            }
        }
    }
    let mut samples = vec![];
    let start = sim.tick_count();
    samples.push(Sample { tick: 0, stored: count(&sim, &req.containers, &req.items) });
    let t0 = Instant::now();
    let mut done = 0;
    while done < req.duration_ticks {
        let step = req.sample_every.min(req.duration_ticks - done).max(1);
        sim.run(step);
        done = sim.tick_count() - start;
        samples.push(Sample { tick: done, stored: count(&sim, &req.containers, &req.items) });
    }
    let elapsed = t0.elapsed().as_secs_f64() * 1000.0;
    let ground_items = sim
        .item_entities()
        .iter()
        .filter(|e| !e.removed)
        .map(|e| GroundItem { item: e.item.0.clone(), count: e.item.1, pos: e.pos })
        .collect();
    Ok(Response {
        ok: true,
        error: None,
        samples,
        ground_items,
        ms_per_tick: if done > 0 { Some(elapsed / done as f64) } else { None },
    })
}

fn main() {
    let mut input = String::new();
    std::io::stdin().read_to_string(&mut input).expect("stdin");
    let response = match serde_json::from_str::<Request>(&input) {
        Err(e) => Response { ok: false, error: Some(format!("request: {e}")), samples: vec![], ground_items: vec![], ms_per_tick: None },
        Ok(req) => match std::panic::catch_unwind(|| run(req)) {
            Ok(Ok(r)) => r,
            Ok(Err(e)) => Response { ok: false, error: Some(e), samples: vec![], ground_items: vec![], ms_per_tick: None },
            Err(p) => Response {
                ok: false,
                error: Some(p.downcast_ref::<String>().cloned().or_else(|| p.downcast_ref::<&str>().map(|s| s.to_string())).unwrap_or_else(|| "engine panic".into())),
                samples: vec![],
                ground_items: vec![],
                ms_per_tick: None,
            },
        },
    };
    println!("{}", serde_json::to_string(&response).expect("json"));
}
