use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::{HashMap, HashSet};

pub const UNMOUNTED: &str = "__modality_unmounted__";

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(tag = "kind")]
pub enum AbstractDomain {
    #[serde(rename = "bool")]
    Bool,
    #[serde(rename = "enum")]
    Enum { values: Vec<String> },
    #[serde(rename = "boundedInt")]
    BoundedInt { min: i64, max: i64 },
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
    RouteLocal { route: String },
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
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(tag = "kind")]
pub enum ExprIR {
    #[serde(rename = "lit")]
    Lit { value: Value },
    #[serde(rename = "read")]
    Read { var: String, path: Option<Vec<String>> },
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
    #[serde(rename = "readPre")]
    ReadPre { var: String, path: Option<Vec<String>> },
    #[serde(rename = "readOpArg")]
    ReadOpArg { key: String },
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
    Navigate {
        mode: String,
        to: Option<ExprIR>,
    },
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
#[serde(rename_all = "camelCase")]
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
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct CheckRequest {
    pub model: Model,
    pub properties: Vec<PropertyIR>,
    pub options: Option<CheckOptionsIR>,
}

#[derive(Debug, Clone)]
pub struct CompiledVar {
    pub route_pattern: Option<String>,
}

#[derive(Debug, Clone)]
pub struct CompiledTransition {
    pub read_indexes: Vec<usize>,
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
                route_pattern: match &decl.scope {
                    Scope::RouteLocal { route, .. } => Some(route.clone()),
                    Scope::Global => None,
                },
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
            let touched: HashSet<usize> = read_indexes.iter().chain(write_indexes.iter()).copied().collect();
            let route_local_var_indexes = vars
                .iter()
                .enumerate()
                .filter_map(|(idx, compiled_var)| {
                    if compiled_var.route_pattern.is_some() && touched.contains(&idx) {
                        Some(idx)
                    } else {
                        None
                    }
                })
                .collect();
            transitions.push(CompiledTransition {
                read_indexes,
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

    pub fn transition_meta(&self, idx: usize) -> &CompiledTransition {
        &self.transitions[idx]
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
            then,
            else_branch,
            ..
        } => {
            validate_no_opaque(then, transition_id)?;
            validate_no_opaque(else_branch, transition_id)
        }
        _ => Ok(()),
    }
}

pub fn route_local_mounted(
    compiled: &CompiledModel,
    transition_idx: usize,
    state: &crate::state::ModelState,
) -> bool {
    let current_route = compiled
        .sys_route_index
        .and_then(|idx| state.get(idx).as_str());
    for &var_idx in &compiled.transitions[transition_idx].route_local_var_indexes {
        if let Some(route) = &compiled.vars[var_idx].route_pattern {
            if current_route != Some(route.as_str()) {
                return false;
            }
        }
    }
    true
}

pub fn route_local_mounted_transition(
    compiled: &CompiledModel,
    transition: &Transition,
    state: &crate::state::ModelState,
) -> bool {
    let Some(&idx) = compiled.transition_index.get(&transition.id) else {
        return false;
    };
    route_local_mounted(compiled, idx, state)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

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
                guard: ExprIR::Lit {
                    value: json!(true),
                },
                effect,
                reads: vec![],
                writes: vec![],
                confidence: "exact".into(),
                triggered_by: None,
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
            expr: ExprIR::Lit {
                value: json!("/"),
            },
        });
        model.transitions[0].cls = "internal".into();
        model.transitions[0].triggered_by = Some(vec!["missing".into()]);
        model.transitions[0].reads = vec!["missing".into()];
        let err = CompiledModel::compile(model, false).unwrap_err();
        assert!(err.contains("missing"));
    }
}
