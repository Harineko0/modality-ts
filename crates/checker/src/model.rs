use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::{HashMap, HashSet};

pub const UNMOUNTED: &str = "__modality_unmounted__";

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum NumericOverflowPolicy {
    #[serde(rename = "forbid")]
    Forbid,
    #[serde(rename = "wrap")]
    Wrap,
    #[serde(rename = "saturate")]
    Saturate,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(tag = "kind")]
pub enum AbstractDomain {
    #[serde(rename = "bool")]
    Bool,
    #[serde(rename = "enum")]
    Enum { values: Vec<String> },
    #[serde(rename = "boundedInt")]
    BoundedInt {
        min: i64,
        max: i64,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        overflow: Option<NumericOverflowPolicy>,
    },
    #[serde(rename = "intSet")]
    IntSet {
        values: Vec<i64>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        overflow: Option<NumericOverflowPolicy>,
    },
    #[serde(rename = "option")]
    Option { inner: Box<AbstractDomain> },
    #[serde(rename = "record")]
    Record {
        fields: HashMap<String, AbstractDomain>,
    },
    #[serde(rename = "tagged")]
    Tagged {
        tag: String,
        variants: HashMap<String, AbstractDomain>,
    },
    #[serde(rename = "tokens")]
    Tokens {
        count: u32,
        names: Option<Vec<String>>,
    },
    #[serde(rename = "lengthCat")]
    LengthCat,
    #[serde(rename = "boundedList")]
    BoundedList {
        inner: Box<AbstractDomain>,
        #[serde(rename = "maxLen")]
        max_len: u32,
    },
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(untagged)]
pub enum InitialValue {
    Single(Value),
    Many(Vec<Value>),
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(tag = "kind", rename_all = "kebab-case")]
pub enum Scope {
    Global,
    #[serde(rename = "route-local")]
    RouteLocal {
        route: String,
    },
    #[serde(rename = "mount-local")]
    MountLocal {
        id: String,
        when: ExprIR,
    },
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StateVarDecl {
    pub id: String,
    pub domain: AbstractDomain,
    pub origin: Value,
    pub scope: Scope,
    pub initial: InitialValue,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Transition {
    pub id: String,
    pub cls: String,
    pub label: Value,
    pub source: Vec<Value>,
    pub guard: ExprIR,
    pub effect: EffectIR,
    pub reads: Vec<String>,
    pub writes: Vec<String>,
    pub confidence: String,
    pub triggered_by: Option<Vec<String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub phase: Option<u32>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(tag = "kind")]
pub enum ExprIR {
    #[serde(rename = "lit")]
    Lit { value: Value },
    #[serde(rename = "read")]
    Read {
        var: String,
        path: Option<Vec<String>>,
    },
    #[serde(rename = "eq")]
    Eq { args: Vec<ExprIR> },
    #[serde(rename = "neq")]
    Neq { args: Vec<ExprIR> },
    #[serde(rename = "and")]
    And { args: Vec<ExprIR> },
    #[serde(rename = "or")]
    Or { args: Vec<ExprIR> },
    #[serde(rename = "not")]
    Not { args: Vec<ExprIR> },
    #[serde(rename = "cond")]
    Cond { args: Vec<ExprIR> },
    #[serde(rename = "updateField")]
    UpdateField {
        target: Box<ExprIR>,
        path: Vec<String>,
        value: Box<ExprIR>,
    },
    #[serde(rename = "tagIs")]
    TagIs { arg: Box<ExprIR>, tag: String },
    #[serde(rename = "lenCat")]
    LenCat { arg: Box<ExprIR> },
    #[serde(rename = "freshToken")]
    FreshToken {
        #[serde(rename = "domainOf")]
        domain_of: String,
    },
    #[serde(rename = "transitionEnabled")]
    TransitionEnabled {
        #[serde(rename = "transitionId")]
        transition_id: String,
    },
    #[serde(rename = "transitionEnabledPrefix")]
    TransitionEnabledPrefix {
        prefix: String,
    },
    #[serde(rename = "readPre")]
    ReadPre {
        var: String,
        path: Option<Vec<String>>,
    },
    #[serde(rename = "readOpArg")]
    ReadOpArg { key: String },
    #[serde(rename = "lt")]
    Lt { args: Vec<ExprIR> },
    #[serde(rename = "lte")]
    Lte { args: Vec<ExprIR> },
    #[serde(rename = "gt")]
    Gt { args: Vec<ExprIR> },
    #[serde(rename = "gte")]
    Gte { args: Vec<ExprIR> },
    #[serde(rename = "add")]
    Add { args: Vec<ExprIR> },
    #[serde(rename = "sub")]
    Sub { args: Vec<ExprIR> },
    #[serde(rename = "mod")]
    Mod { args: Vec<ExprIR> },
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OpaqueRef {
    pub module: String,
    #[serde(rename = "export")]
    pub export_name: String,
    pub declared_reads: Vec<String>,
    pub declared_writes: Vec<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(tag = "kind")]
pub enum EffectIR {
    #[serde(rename = "assign")]
    Assign { var: String, expr: ExprIR },
    #[serde(rename = "havoc")]
    Havoc { var: String },
    #[serde(rename = "choose")]
    Choose { var: String, among: Vec<ExprIR> },
    #[serde(rename = "if")]
    If {
        cond: ExprIR,
        then: Box<EffectIR>,
        #[serde(rename = "else")]
        else_branch: Box<EffectIR>,
    },
    #[serde(rename = "seq")]
    Seq { effects: Vec<EffectIR> },
    #[serde(rename = "enqueue")]
    Enqueue {
        op: String,
        continuation: String,
        args: HashMap<String, ExprIR>,
    },
    #[serde(rename = "dequeue")]
    Dequeue { index: usize },
    #[serde(rename = "navigate")]
    Navigate { mode: String, to: Option<ExprIR> },
    #[serde(rename = "opaque")]
    Opaque { r#ref: OpaqueRef },
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Bounds {
    pub max_depth: u32,
    pub max_pending: u32,
    pub max_internal_steps: u32,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Model {
    pub schema_version: u32,
    pub id: String,
    pub vars: Vec<StateVarDecl>,
    pub transitions: Vec<Transition>,
    pub bounds: Bounds,
    pub metadata: Option<Value>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct StepPredicateIR {
    pub transition_id: Option<String>,
    pub transition_class: Option<String>,
    pub label_kind: Option<String>,
    pub enqueued: Option<String>,
    pub resolved: Option<Vec<String>>,
    pub navigated: Option<bool>,
    pub navigated_to: Option<String>,
    pub op_id: Option<String>,
    pub continuation: Option<String>,
    pub op_args: Option<serde_json::Map<String, Value>>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(untagged)]
pub enum StepPredicateSpec {
    Composite(StepPredicateComposite),
    Flat(StepPredicateIR),
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct StepPredicateComposite {
    pub pre: Option<ExprIR>,
    pub step: StepPredicateIR,
    pub post: Option<ExprIR>,
    pub negate: Option<bool>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(tag = "kind")]
pub enum PropertyIR {
    #[serde(rename = "always")]
    Always {
        name: String,
        predicate: ExprIR,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        reads: Option<Vec<String>>,
        #[serde(
            rename = "enabledTransitions",
            default,
            skip_serializing_if = "Option::is_none"
        )]
        enabled_transitions: Option<Vec<String>>,
        #[serde(
            rename = "includeUnmounted",
            default,
            skip_serializing_if = "Option::is_none"
        )]
        include_unmounted: Option<bool>,
    },
    #[serde(rename = "reachable")]
    Reachable {
        name: String,
        predicate: ExprIR,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        reads: Option<Vec<String>>,
        #[serde(
            rename = "enabledTransitions",
            default,
            skip_serializing_if = "Option::is_none"
        )]
        enabled_transitions: Option<Vec<String>>,
        #[serde(
            rename = "includeUnmounted",
            default,
            skip_serializing_if = "Option::is_none"
        )]
        include_unmounted: Option<bool>,
    },
    #[serde(rename = "alwaysStep")]
    AlwaysStep {
        name: String,
        predicate: StepPredicateSpec,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        reads: Option<Vec<String>>,
        #[serde(
            rename = "enabledTransitions",
            default,
            skip_serializing_if = "Option::is_none"
        )]
        enabled_transitions: Option<Vec<String>>,
        #[serde(
            rename = "includeUnmounted",
            default,
            skip_serializing_if = "Option::is_none"
        )]
        include_unmounted: Option<bool>,
    },
    #[serde(rename = "reachableFrom")]
    ReachableFrom {
        name: String,
        when: ExprIR,
        goal: ExprIR,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        reads: Option<Vec<String>>,
        #[serde(
            rename = "enabledTransitions",
            default,
            skip_serializing_if = "Option::is_none"
        )]
        enabled_transitions: Option<Vec<String>>,
        #[serde(
            rename = "includeUnmounted",
            default,
            skip_serializing_if = "Option::is_none"
        )]
        include_unmounted: Option<bool>,
    },
    #[serde(rename = "leadsToWithin")]
    LeadsToWithin {
        name: String,
        trigger: StepPredicateIR,
        goal: ExprIR,
        budget: LeadsBudget,
        #[serde(
            rename = "allowUserEvents",
            default,
            skip_serializing_if = "Option::is_none"
        )]
        allow_user_events: Option<bool>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        reads: Option<Vec<String>>,
        #[serde(
            rename = "enabledTransitions",
            default,
            skip_serializing_if = "Option::is_none"
        )]
        enabled_transitions: Option<Vec<String>>,
        #[serde(
            rename = "includeUnmounted",
            default,
            skip_serializing_if = "Option::is_none"
        )]
        include_unmounted: Option<bool>,
    },
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct LeadsBudget {
    pub steps: Option<u32>,
    pub environment: Option<u32>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CheckOptionsIR {
    pub slicing: Option<bool>,
    pub sliced_model: Option<bool>,
    pub max_states: Option<u32>,
    pub max_edges: Option<u32>,
    pub max_frontier: Option<u32>,
    pub track_elapsed: Option<bool>,
    pub memory_guard_bytes: Option<u64>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct CheckRequest {
    pub model: Model,
    pub properties: Vec<PropertyIR>,
    pub options: Option<CheckOptionsIR>,
}

#[derive(Debug, Clone)]
pub struct CompiledVar {
    pub mount_guard: Option<ExprIR>,
}

#[derive(Debug, Clone)]
pub struct CompiledTransition {
    pub write_indexes: Vec<usize>,
    pub triggered_by_indexes: Vec<usize>,
    pub route_local_var_indexes: Vec<usize>,
}

#[derive(Debug)]
pub struct CompiledModel {
    pub model: Model,
    pub vars: Vec<CompiledVar>,
    pub transitions: Vec<CompiledTransition>,
    pub var_index: HashMap<String, usize>,
    pub transition_index: HashMap<String, usize>,
    pub sorted_transitions: Vec<Transition>,
    pub non_internal: Vec<usize>,
    pub internal: Vec<usize>,
    pub internal_by_triggered_var: HashMap<usize, Vec<usize>>,
    pub always_triggered_internal: Vec<usize>,
    pub sys_route_index: Option<usize>,
    pub sys_history_index: Option<usize>,
    pub sys_pending_index: Option<usize>,
}

impl CompiledModel {
    pub fn compile(model: Model, sliced: bool) -> Result<Self, String> {
        crate::domain::validate_model_with_options(&model, sliced)?;
        let var_index: HashMap<String, usize> = model
            .vars
            .iter()
            .enumerate()
            .map(|(i, v)| (v.id.clone(), i))
            .collect();
        let sys_route_index = var_index.get("sys:route").copied();
        let sys_history_index = var_index.get("sys:history").copied();
        let sys_pending_index = var_index.get("sys:pending").copied();

        let vars: Vec<CompiledVar> = model
            .vars
            .iter()
            .map(|decl| CompiledVar {
                mount_guard: mount_guard_for_scope(&decl.scope),
            })
            .collect();

        let mut sorted_transitions = model.transitions.clone();
        sorted_transitions.sort_by(|a, b| a.id.cmp(&b.id));
        let transition_index: HashMap<String, usize> = sorted_transitions
            .iter()
            .enumerate()
            .map(|(i, t)| (t.id.clone(), i))
            .collect();

        let mut transitions = Vec::with_capacity(sorted_transitions.len());
        for transition in &sorted_transitions {
            validate_no_opaque(&transition.effect, &transition.id)?;
            let read_indexes = resolve_var_indexes(&var_index, &transition.reads)?;
            let write_indexes = resolve_var_indexes(&var_index, &transition.writes)?;
            let triggered_by_indexes = match transition.triggered_by.as_ref() {
                None => Vec::new(),
                Some(vars) if vars.is_empty() => Vec::new(),
                Some(vars) => resolve_var_indexes(&var_index, vars)?,
            };
            let touched: HashSet<usize> = read_indexes
                .iter()
                .chain(write_indexes.iter())
                .copied()
                .collect();
            let route_local_var_indexes = vars
                .iter()
                .enumerate()
                .filter_map(|(idx, compiled_var)| {
                    if compiled_var.mount_guard.is_some() && touched.contains(&idx) {
                        Some(idx)
                    } else {
                        None
                    }
                })
                .collect();
            transitions.push(CompiledTransition {
                write_indexes,
                triggered_by_indexes,
                route_local_var_indexes,
            });
        }

        let non_internal: Vec<usize> = sorted_transitions
            .iter()
            .enumerate()
            .filter(|(_, t)| t.cls != "internal")
            .map(|(i, _)| i)
            .collect();
        let internal: Vec<usize> = sorted_transitions
            .iter()
            .enumerate()
            .filter(|(_, t)| t.cls == "internal")
            .map(|(i, _)| i)
            .collect();
        let mut internal_by_triggered_var: HashMap<usize, Vec<usize>> = HashMap::new();
        let mut always_triggered_internal = Vec::new();
        for transition in &internal {
            let t = &sorted_transitions[*transition];
            match t.triggered_by.as_deref() {
                None | Some([]) => always_triggered_internal.push(*transition),
                Some(vars) => {
                    for var_id in vars {
                        let idx = *var_index
                            .get(var_id)
                            .ok_or_else(|| format!("{}: unknown triggeredBy var {var_id}", t.id))?;
                        internal_by_triggered_var
                            .entry(idx)
                            .or_default()
                            .push(*transition);
                    }
                }
            }
        }

        Ok(Self {
            model,
            vars,
            transitions,
            var_index,
            transition_index,
            sorted_transitions,
            non_internal,
            internal,
            internal_by_triggered_var,
            always_triggered_internal,
            sys_route_index,
            sys_history_index,
            sys_pending_index,
        })
    }

    pub fn transition(&self, idx: usize) -> &Transition {
        &self.sorted_transitions[idx]
    }

    pub fn var_decl(&self, id: &str) -> Option<&StateVarDecl> {
        self.var_index.get(id).map(|&i| &self.model.vars[i])
    }

    pub fn var_idx(&self, id: &str) -> Option<usize> {
        self.var_index.get(id).copied()
    }
}

fn resolve_var_indexes(
    var_index: &HashMap<String, usize>,
    ids: &[String],
) -> Result<Vec<usize>, String> {
    ids.iter()
        .map(|id| {
            var_index
                .get(id)
                .copied()
                .ok_or_else(|| format!("references unknown var {id}"))
        })
        .collect()
}

fn validate_no_opaque(effect: &EffectIR, transition_id: &str) -> Result<(), String> {
    match effect {
        EffectIR::Opaque { r#ref } => Err(format!(
            "{transition_id}: unsupported opaque effect {}#{}",
            r#ref.module, r#ref.export_name
        )),
        EffectIR::Seq { effects } => {
            for child in effects {
                validate_no_opaque(child, transition_id)?;
            }
            Ok(())
        }
        EffectIR::If {
            then, else_branch, ..
        } => {
            validate_no_opaque(then, transition_id)?;
            validate_no_opaque(else_branch, transition_id)
        }
        _ => Ok(()),
    }
}

pub fn mount_guard_for_scope(scope: &Scope) -> Option<ExprIR> {
    match scope {
        Scope::Global => None,
        Scope::RouteLocal { route, .. } => Some(ExprIR::Eq {
            args: vec![
                ExprIR::Read {
                    var: "sys:route".into(),
                    path: None,
                },
                ExprIR::Lit {
                    value: serde_json::Value::String(route.clone()),
                },
            ],
        }),
        Scope::MountLocal { when, .. } => Some(when.clone()),
    }
}

pub fn transition_locals_mounted(
    compiled: &CompiledModel,
    transition_idx: usize,
    state: &crate::state::ModelState,
) -> bool {
    for &var_idx in &compiled.transitions[transition_idx].route_local_var_indexes {
        if let Some(guard) = &compiled.vars[var_idx].mount_guard {
            if !crate::expr::mount_guard_holds(compiled, state, guard) {
                return false;
            }
        }
    }
    true
}

#[allow(dead_code)]
pub fn route_local_mounted(
    compiled: &CompiledModel,
    transition_idx: usize,
    state: &crate::state::ModelState,
) -> bool {
    transition_locals_mounted(compiled, transition_idx, state)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::state::ModelState;
    use serde_json::{json, Value};
    use std::collections::HashMap;

    #[test]
    fn transition_locals_mounted_uses_mount_guard() {
        let model = Model {
            schema_version: 1,
            id: "m".into(),
            vars: vec![
                StateVarDecl {
                    id: "sys:route".into(),
                    domain: AbstractDomain::Enum {
                        values: vec!["/a".into(), "/b".into()],
                    },
                    origin: json!("system"),
                    scope: Scope::Global,
                    initial: InitialValue::Single(json!("/a")),
                },
                StateVarDecl {
                    id: "sys:history".into(),
                    domain: AbstractDomain::BoundedList {
                        inner: Box::new(AbstractDomain::Enum {
                            values: vec!["/a".into(), "/b".into()],
                        }),
                        max_len: 2,
                    },
                    origin: json!("system"),
                    scope: Scope::Global,
                    initial: InitialValue::Single(json!([])),
                },
                StateVarDecl {
                    id: "sys:pending".into(),
                    domain: AbstractDomain::BoundedList {
                        inner: Box::new(AbstractDomain::Record {
                            fields: HashMap::new(),
                        }),
                        max_len: 0,
                    },
                    origin: json!("system"),
                    scope: Scope::Global,
                    initial: InitialValue::Single(json!([])),
                },
                StateVarDecl {
                    id: "local:panel".into(),
                    domain: AbstractDomain::Bool,
                    origin: json!("test"),
                    scope: Scope::MountLocal {
                        id: "slot".into(),
                        when: ExprIR::Eq {
                            args: vec![
                                ExprIR::Read {
                                    var: "sys:route".into(),
                                    path: None,
                                },
                                ExprIR::Lit {
                                    value: json!("/a"),
                                },
                            ],
                        },
                    },
                    initial: InitialValue::Single(json!(true)),
                },
            ],
            transitions: vec![Transition {
                id: "touch".into(),
                cls: "user".into(),
                label: json!({"kind": "click"}),
                source: vec![],
                guard: ExprIR::Lit { value: json!(true) },
                effect: EffectIR::Assign {
                    var: "local:panel".into(),
                    expr: ExprIR::Lit { value: json!(false) },
                },
                reads: vec!["local:panel".into()],
                writes: vec!["local:panel".into()],
                confidence: "exact".into(),
                triggered_by: None,
                phase: None,
            }],
            bounds: Bounds {
                max_depth: 1,
                max_pending: 0,
                max_internal_steps: 1,
            },
            metadata: None,
        };
        let compiled = CompiledModel::compile(model, false).unwrap();
        let route_idx = compiled.sys_route_index.unwrap();
        let panel_idx = compiled.var_idx("local:panel").unwrap();
        let mut on_a = ModelState::new(vec![Value::Null; compiled.model.vars.len()]);
        on_a.values[route_idx] = json!("/a");
        on_a.values[panel_idx] = json!(true);
        let mut on_b = on_a.clone();
        on_b.values[route_idx] = json!("/b");
        assert!(transition_locals_mounted(&compiled, 0, &on_a));
        assert!(!transition_locals_mounted(&compiled, 0, &on_b));
    }

    fn minimal_model(effect: EffectIR) -> Model {
        Model {
            schema_version: 1,
            id: "m".into(),
            vars: vec![
                StateVarDecl {
                    id: "sys:route".into(),
                    domain: AbstractDomain::Enum {
                        values: vec!["/".into()],
                    },
                    origin: json!("system"),
                    scope: Scope::Global,
                    initial: InitialValue::Single(json!("/")),
                },
                StateVarDecl {
                    id: "sys:history".into(),
                    domain: AbstractDomain::BoundedList {
                        inner: Box::new(AbstractDomain::Enum {
                            values: vec!["/".into()],
                        }),
                        max_len: 0,
                    },
                    origin: json!("system"),
                    scope: Scope::Global,
                    initial: InitialValue::Single(json!([])),
                },
                StateVarDecl {
                    id: "sys:pending".into(),
                    domain: AbstractDomain::BoundedList {
                        inner: Box::new(AbstractDomain::Record {
                            fields: HashMap::new(),
                        }),
                        max_len: 0,
                    },
                    origin: json!("system"),
                    scope: Scope::Global,
                    initial: InitialValue::Single(json!([])),
                },
            ],
            transitions: vec![Transition {
                id: "t1".into(),
                cls: "user".into(),
                label: json!({"kind": "click"}),
                source: vec![],
                guard: ExprIR::Lit { value: json!(true) },
                effect,
                reads: vec![],
                writes: vec![],
                confidence: "exact".into(),
                triggered_by: None,
                phase: None,
            }],
            bounds: Bounds {
                max_depth: 1,
                max_pending: 0,
                max_internal_steps: 1,
            },
            metadata: None,
        }
    }

    #[test]
    fn compile_rejects_opaque_effects() {
        let model = minimal_model(EffectIR::Opaque {
            r#ref: OpaqueRef {
                module: "m".into(),
                export_name: "f".into(),
                declared_reads: vec![],
                declared_writes: vec![],
            },
        });
        let err = CompiledModel::compile(model, false).unwrap_err();
        assert!(err.contains("unsupported opaque effect"));
    }

    #[test]
    fn compile_rejects_unknown_triggered_by_var() {
        let mut model = minimal_model(EffectIR::Assign {
            var: "sys:route".into(),
            expr: ExprIR::Lit { value: json!("/") },
        });
        model.transitions[0].cls = "internal".into();
        model.transitions[0].triggered_by = Some(vec!["missing".into()]);
        model.transitions[0].reads = vec!["missing".into()];
        let err = CompiledModel::compile(model, false).unwrap_err();
        assert!(err.contains("missing"));
    }
}
