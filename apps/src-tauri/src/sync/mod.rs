pub mod drive;

use oauth2::PkceCodeVerifier;
use tokio::sync::oneshot;

#[derive(Default)]
pub struct DriveState {
  pub pending_code_rx: Option<oneshot::Receiver<String>>,
  pub pkce_verifier: Option<PkceCodeVerifier>,
  pub csrf_state: Option<String>,
  pub redirect_uri: Option<String>
}

pub struct PendingAuth {
  pub code_rx: oneshot::Receiver<String>,
  pub pkce_verifier: PkceCodeVerifier,
  pub redirect_uri: String
}

impl DriveState {
  pub fn take_pending(&mut self) -> Option<PendingAuth> {
    let code_rx = self.pending_code_rx.take()?;
    let pkce_verifier = self.pkce_verifier.take()?;
    let redirect_uri = self.redirect_uri.take()?;
    Some(PendingAuth {
      code_rx,
      pkce_verifier,
      redirect_uri
    })
  }
}
