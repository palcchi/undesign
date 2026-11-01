//! The Agent panel: a small, transparent prompt-to-command surface.

use egui::{RichText, Ui};
use undesign_agent::{DEFAULT_MAX_TOKENS, Replay, run_turn};

use crate::FigApp;
use crate::theme::Tokens;
use crate::widgets;

const EXAMPLES: &[&str] = &["logo bola memantul", "tiga lingkaran", "spinner loading", "lower-third", "tombol pulse"];

#[derive(Clone, Debug)]
pub struct AgentTurn {
    pub prompt: String,
    pub commands: Vec<String>,
    pub undone: bool,
}

#[derive(Debug, Default)]
pub struct AgentUi {
    pub prompt: String,
    pub status: String,
    pub history: Vec<AgentTurn>,
}

pub fn panel(app: &mut FigApp, ui: &mut Ui) {
    let tokens = Tokens::get(ui.ctx());
    ui.heading(RichText::new("Agent").color(tokens.text));
    ui.label(RichText::new("Describe a design or animation. The Agent applies editable engine commands.").color(tokens.text_secondary));
    ui.add_space(8.0);

    ui.label(RichText::new("Examples").strong().color(tokens.text));
    ui.horizontal_wrapped(|ui| {
        for example in EXAMPLES {
            if ui.small_button(*example).clicked() {
                app.ui.agent.prompt = (*example).to_string();
            }
        }
    });
    ui.add_space(8.0);

    ui.label(RichText::new("Prompt").strong().color(tokens.text));
    let edit = egui::TextEdit::multiline(&mut app.ui.agent.prompt).desired_rows(4).hint_text("e.g. logo bola memantul lalu teks Undesign fade-in");
    ui.add_sized([ui.available_width(), 88.0], edit);
    ui.add_space(6.0);

    let can_run = !app.ui.agent.prompt.trim().is_empty();
    if widgets::button(ui, "Run Agent", true, can_run).clicked() {
        run_prompt(app);
    }
    if !app.ui.agent.status.is_empty() {
        ui.add_space(6.0);
        ui.label(RichText::new(&app.ui.agent.status).color(tokens.text_secondary));
    }

    ui.separator();
    ui.label(RichText::new("Turns").strong().color(tokens.text));
    if app.ui.agent.history.is_empty() {
        ui.label(RichText::new("No turns yet. Choose an example or write a prompt.").color(tokens.text_secondary));
        return;
    }
    for index in (0..app.ui.agent.history.len()).rev() {
        let turn = app.ui.agent.history[index].clone();
        ui.group(|ui| {
            ui.horizontal(|ui| {
                ui.label(RichText::new(&turn.prompt).strong().color(tokens.text));
                if turn.undone {
                    ui.label(RichText::new("Undone").color(tokens.text_secondary));
                } else if ui.small_button("Undo").clicked() {
                    undo_turn(app, index);
                }
            });
            if turn.commands.is_empty() {
                ui.label(RichText::new("No commands applied").color(tokens.text_secondary));
            } else {
                ui.label(RichText::new(format!("Applied: {}", turn.commands.join(", "))).color(tokens.text_secondary));
            }
        });
    }
}

fn run_prompt(app: &mut FigApp) {
    let prompt = app.ui.agent.prompt.trim().to_string();
    if prompt.is_empty() {
        return;
    }
    app.ui.agent.status = "Thinking...".into();
    let mut replay = Replay::demo();
    match run_turn(&mut app.session, &mut replay, &prompt, DEFAULT_MAX_TOKENS) {
        Ok(report) => {
            app.ui.agent.status = format!("Applying {} commands", report.applied.len());
            app.ui.agent.history.push(AgentTurn { prompt, commands: report.applied, undone: false });
        }
        Err(error) => {
            app.ui.agent.status = format!("Agent failed: {error}");
            app.toast(format!("Agent failed: {error}"));
        }
    }
}

fn undo_turn(app: &mut FigApp, index: usize) {
    match app.session.undo() {
        Ok(true) => {
            if let Some(turn) = app.ui.agent.history.get_mut(index) {
                turn.undone = true;
            }
            app.ui.agent.status = "Turn undone".into();
        }
        Ok(false) => app.toast("Nothing to undo"),
        Err(error) => app.toast(format!("Undo failed: {error}")),
    }
}
