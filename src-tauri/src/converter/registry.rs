use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
use std::process::Child;
use std::sync::{Mutex, MutexGuard, PoisonError};

use super::JobId;

pub struct RunningJob {
    pub(super) child: Child,
    pub(super) output: PathBuf,
}

#[derive(Default)]
pub struct Registry {
    running: Mutex<HashMap<JobId, RunningJob>>,
}

impl Registry {
    fn lock(&self) -> MutexGuard<'_, HashMap<JobId, RunningJob>> {
        self.running.lock().unwrap_or_else(PoisonError::into_inner)
    }

    pub(super) fn register(&self, id: JobId, job: RunningJob) {
        self.lock().insert(id, job);
    }

    pub(super) fn take(&self, id: JobId) -> Option<RunningJob> {
        self.lock().remove(&id)
    }
}

fn stop(mut job: RunningJob) {
    let _ = job.child.kill();
    // Windows cannot delete a file the process still has open.
    let _ = job.child.wait();
    let _ = fs::remove_file(&job.output);
}

/// Holds the registry lock while stopping so `convert` cannot report `Canceled` before the file is gone.
pub fn cancel(registry: &Registry, id: JobId) {
    let mut running = registry.lock();
    if let Some(job) = running.remove(&id) {
        stop(job);
    }
}

pub fn cancel_all(registry: &Registry) {
    for (_, job) in registry.lock().drain() {
        stop(job);
    }
}
