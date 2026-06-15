use sysinfo::{Pid, ProcessesToUpdate, System};

pub fn current_process_memory_bytes() -> Option<u64> {
    let mut system = System::new();
    let pid = Pid::from_u32(std::process::id());
    system.refresh_processes(ProcessesToUpdate::Some(&[pid]), false);
    system.process(pid).map(|process| process.memory())
}
