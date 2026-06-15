use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use std::collections::HashMap;

pub const UNMOUNTED: &str = "__modality_unmounted__";

pub type ModelState = Map<String, Value>;

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
    pub op_args: Option<Map<String, Value>>,
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

pub struct CompiledModel {
    pub model: Model,
    pub var_index: HashMap<String, usize>,
    pub transition_index: HashMap<String, usize>,
    pub sorted_transitions: Vec<Transition>,
    pub non_internal: Vec<usize>,
    pub internal: Vec<usize>,
    pub internal_by_triggered_var: HashMap<String, Vec<usize>>,
    pub always_triggered_internal: Vec<usize>,
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
        let mut sorted_transitions = model.transitions.clone();
        sorted_transitions.sort_by(|a, b| a.id.cmp(&b.id));
        let transition_index: HashMap<String, usize> = sorted_transitions
            .iter()
            .enumerate()
            .map(|(i, t)| (t.id.clone(), i))
            .collect();
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
        let mut internal_by_triggered_var: HashMap<String, Vec<usize>> = HashMap::new();
        let mut always_triggered_internal = Vec::new();
        for transition in &internal {
            let t = &sorted_transitions[*transition];
            match t.triggered_by.as_deref() {
                None | Some([]) => always_triggered_internal.push(*transition),
                Some(vars) => {
                    for var_id in vars {
                        internal_by_triggered_var
                            .entry(var_id.clone())
                            .or_default()
                            .push(*transition);
                    }
                }
            }
        }
        Ok(Self {
            model,
            var_index,
            transition_index,
            sorted_transitions,
            non_internal,
            internal,
            internal_by_triggered_var,
            always_triggered_internal,
        })
    }

    pub fn transition(&self, idx: usize) -> &Transition {
        &self.sorted_transitions[idx]
    }

    pub fn var_decl(&self, id: &str) -> Option<&StateVarDecl> {
        self.var_index.get(id).map(|&i| &self.model.vars[i])
    }
}

pub fn route_local_mounted(
    compiled: &CompiledModel,
    transition: &Transition,
    state: &ModelState,
) -> bool {
    let current_route = state.get("sys:route");
    let mut touched: std::collections::HashSet<&str> =
        transition.reads.iter().map(|s| s.as_str()).collect();
    for w in &transition.writes {
        touched.insert(w);
    }
    for decl in &compiled.model.vars {
        let route_local = match &decl.scope {
            Scope::RouteLocal { route, .. } => Some(route.as_str()),
            _ => None,
        };
        if let Some(route) = route_local {
            if touched.contains(decl.id.as_str()) && current_route != Some(&Value::String(route.to_string())) {
                return false;
            }
        }
    }
    true
}
