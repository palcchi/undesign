use std::fmt;
use std::io::{Read, Write};
use std::process::{Command, Stdio};
use std::sync::OnceLock;

use serde_json::Value;
use url::{Host, Url};
use zeroize::Zeroizing;

use undesign_ui_egui::agent_provider::{
    AgentProviderAvailability, AgentProviderConfig, AgentProviderReply, AgentProviderTask, AgentSecret, MAX_PROVIDER_REQUEST_BYTES,
    MAX_PROVIDER_RESPONSE_BYTES, parse_openai_response, validate_model_id,
};

const STATUS_MARKER: &[u8] = b"\nUNDESIGN_HTTP_STATUS:";
const STATUS_FORMAT: &str = "\nUNDESIGN_HTTP_STATUS:%{http_code}";
const MAX_STATUS_SUFFIX_BYTES: usize = 64;

struct CurlConfig(Zeroizing<Vec<u8>>);

impl CurlConfig {
    fn as_bytes(&self) -> &[u8] {
        self.0.as_slice()
    }
}

impl fmt::Debug for CurlConfig {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("CurlConfig([redacted])")
    }
}

pub fn availability() -> AgentProviderAvailability {
    if curl_available() { AgentProviderAvailability::NativeOpenAiCompatible } else { AgentProviderAvailability::MissingCurl }
}

pub fn validate_config(config: &AgentProviderConfig) -> Result<(), String> {
    validate_endpoint(config.endpoint())?;
    validate_model_id(config.model())
}

pub fn start_request(config: &AgentProviderConfig, request: Value) -> Result<AgentProviderTask, String> {
    if !curl_available() {
        return Err("The system curl command is not available.".to_string());
    }
    validate_config(config)?;
    let encoded = serde_json::to_vec(&request).map_err(|_| "Could not encode the provider request.".to_string())?;
    if encoded.len() > MAX_PROVIDER_REQUEST_BYTES {
        return Err("The provider request exceeds the size limit.".to_string());
    }
    let endpoint = config.endpoint().to_string();
    let secret = config.duplicate_secret_for_request();
    let (sender, receiver) = std::sync::mpsc::channel();
    std::thread::Builder::new()
        .name("undesign-agent-provider".to_string())
        .spawn(move || {
            let result = send_request(&endpoint, &secret, &request);
            let _ = sender.send(result);
        })
        .map_err(|_| "Could not start the provider request.".to_string())?;
    Ok(AgentProviderTask::new(receiver))
}

pub fn validate_endpoint(endpoint: &str) -> Result<String, String> {
    if endpoint.is_empty() || endpoint.len() > 2048 || endpoint.trim() != endpoint || endpoint.chars().any(char::is_control) {
        return Err("Enter a valid provider URL without whitespace or control characters.".to_string());
    }
    let url = Url::parse(endpoint).map_err(|_| "Enter a valid absolute provider URL.".to_string())?;
    if url.username() != "" || url.password().is_some() {
        return Err("Provider URLs cannot contain a username or password.".to_string());
    }
    if url.query().is_some() || url.fragment().is_some() {
        return Err("Provider URLs cannot contain a query string or fragment.".to_string());
    }
    let loopback = match url.host() {
        Some(Host::Ipv4(address)) => address.is_loopback(),
        Some(Host::Ipv6(address)) => address.is_loopback(),
        Some(Host::Domain(host)) => host.eq_ignore_ascii_case("localhost"),
        None => false,
    };
    match url.scheme() {
        "https" => {}
        "http" if loopback => {}
        "http" => return Err("Use HTTPS for remote providers. HTTP is allowed only for localhost or a loopback IP.".to_string()),
        _ => return Err("Use an HTTPS provider URL, or HTTP for a loopback local server.".to_string()),
    }
    if url.host().is_none() {
        return Err("The provider URL must include a host.".to_string());
    }
    Ok(url.into())
}

fn curl_available() -> bool {
    static AVAILABLE: OnceLock<bool> = OnceLock::new();
    *AVAILABLE.get_or_init(|| {
        Command::new("curl")
            .arg("--version")
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status()
            .is_ok_and(|status| status.success())
    })
}

fn curl_command() -> Command {
    let mut command = Command::new("curl");
    command
        .arg("--disable")
        .args(["--silent", "--show-error", "--connect-timeout", "15", "--max-time", "90", "--max-filesize"])
        .arg(MAX_PROVIDER_RESPONSE_BYTES.to_string())
        .args(["--write-out", STATUS_FORMAT, "--config", "-"]);
    command
}

fn send_request(endpoint: &str, secret: &AgentSecret, request: &Value) -> Result<AgentProviderReply, String> {
    let endpoint = validate_endpoint(endpoint)?;
    let body = serde_json::to_vec(request).map_err(|_| "Could not encode the provider request.".to_string())?;
    if body.len() > MAX_PROVIDER_REQUEST_BYTES {
        return Err("The provider request exceeds the size limit.".to_string());
    }
    let config = curl_config(&endpoint, secret, &body)?;
    let mut child = curl_command()
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|_| "Could not start the system curl command.".to_string())?;
    let Some(mut stdin) = child.stdin.take() else {
        let _ = child.kill();
        let _ = child.wait();
        return Err("Could not prepare the provider request.".to_string());
    };
    if stdin.write_all(config.as_bytes()).is_err() {
        drop(stdin);
        let _ = child.kill();
        let _ = child.wait();
        return Err("Could not send the provider request.".to_string());
    }
    drop(stdin);
    let Some(stdout) = child.stdout.take() else {
        let _ = child.kill();
        let _ = child.wait();
        return Err("Could not read the provider response.".to_string());
    };
    let output_limit = (MAX_PROVIDER_RESPONSE_BYTES + MAX_STATUS_SUFFIX_BYTES + 1) as u64;
    let mut reader = stdout.take(output_limit);
    let mut output = Zeroizing::new(Vec::new());
    if reader.read_to_end(&mut output).is_err() {
        let _ = child.kill();
        let _ = child.wait();
        return Err("Could not read the provider response.".to_string());
    }
    drop(reader);
    if output.len() > MAX_PROVIDER_RESPONSE_BYTES + MAX_STATUS_SUFFIX_BYTES {
        let _ = child.kill();
        let _ = child.wait();
        return Err("The provider response exceeds the size limit.".to_string());
    }
    let process_status = child.wait().map_err(|_| "The provider request did not finish cleanly.".to_string())?;
    if !process_status.success() {
        return Err("Could not contact the provider endpoint. Check network access and TLS settings.".to_string());
    }
    let (response, status) = split_status(&output)?;
    if !(200..300).contains(&status) {
        return Err(format!("The provider returned HTTP {status}. Check the endpoint, model ID, and API key."));
    }
    let response = std::str::from_utf8(response).map_err(|_| "The provider response is not valid UTF-8.".to_string())?;
    let response = Zeroizing::new(response.to_string());
    parse_openai_response(&response)
}

fn curl_config(endpoint: &str, secret: &AgentSecret, body: &[u8]) -> Result<CurlConfig, String> {
    let mut config = Zeroizing::new(Vec::with_capacity(endpoint.len() + secret.expose_bytes().len() + body.len() + 128));
    config.extend_from_slice(b"url = ");
    append_quoted(&mut config, endpoint.as_bytes());
    config.extend_from_slice(b"header = ");
    let mut authorization = Zeroizing::new(b"Authorization: Bearer ".to_vec());
    authorization.extend_from_slice(secret.expose_bytes());
    append_quoted(&mut config, &authorization);
    config.extend_from_slice(b"header = \"Content-Type: application/json\"\n");
    config.extend_from_slice(b"data = ");
    append_quoted(&mut config, body);
    Ok(CurlConfig(config))
}

fn append_quoted(output: &mut Vec<u8>, value: &[u8]) {
    output.push(b'"');
    for byte in value {
        match byte {
            b'"' => output.extend_from_slice(b"\\\""),
            b'\\' => output.extend_from_slice(b"\\\\"),
            b'\n' => output.extend_from_slice(b"\\n"),
            b'\r' => output.extend_from_slice(b"\\r"),
            b'\t' => output.extend_from_slice(b"\\t"),
            _ => output.push(*byte),
        }
    }
    output.extend_from_slice(b"\"\n");
}

fn split_status(output: &[u8]) -> Result<(&[u8], u16), String> {
    let marker_at = output
        .windows(STATUS_MARKER.len())
        .rposition(|window| window == STATUS_MARKER)
        .ok_or_else(|| "The provider response did not include an HTTP status.".to_string())?;
    let status_text = std::str::from_utf8(&output[marker_at + STATUS_MARKER.len()..])
        .map_err(|_| "The provider response had an invalid HTTP status.".to_string())?;
    if status_text.len() != 3 || !status_text.bytes().all(|byte| byte.is_ascii_digit()) {
        return Err("The provider response had an invalid HTTP status.".to_string());
    }
    let status = status_text.parse::<u16>().map_err(|_| "The provider response had an invalid HTTP status.".to_string())?;
    Ok((&output[..marker_at], status))
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    #[test]
    fn endpoint_validation_requires_tls_except_loopback_and_rejects_embedded_credentials() {
        assert!(validate_endpoint("https://api.example/v1/chat/completions").is_ok());
        assert!(validate_endpoint("http://127.0.0.1:8000/v1/chat/completions").is_ok());
        assert!(validate_endpoint("http://[::1]:8000/v1/chat/completions").is_ok());
        assert!(validate_endpoint("http://api.example/v1/chat/completions").is_err());
        assert!(validate_endpoint("file:///tmp/provider").is_err());
        assert!(validate_endpoint("https://user:pass@api.example/v1").is_err());
        assert!(validate_endpoint("https://api.example/v1?key=hidden").is_err());
    }

    #[test]
    fn curl_config_keeps_secret_in_zeroized_stdin_but_not_process_arguments_or_debug() {
        let secret_value = "synthetic-test-token";
        let secret = AgentSecret::from_input(secret_value.to_string());
        assert!(secret.is_ok());
        let Some(secret) = secret.ok() else { return };
        let secret_debug = format!("{secret:?}");
        assert!(secret_debug.contains("[redacted]"));
        assert!(!secret_debug.contains(secret_value));
        let body = serde_json::to_vec(&json!({"message": "quote \" and newline\n"}));
        assert!(body.is_ok());
        let body = body.unwrap_or_default();
        let config = curl_config("https://api.example/v1/chat/completions", &secret, &body);
        assert!(config.is_ok());
        let Some(config) = config.ok() else { return };
        let text = String::from_utf8_lossy(config.as_bytes());
        assert!(text.contains("Authorization: Bearer synthetic-test-token"));
        assert!(text.contains("Content-Type: application/json"));
        assert!(text.contains("data = \""));
        assert!(text.contains("\\\\n"));
        assert!(!format!("{config:?}").contains(secret_value));

        let command = curl_command();
        let args = command.get_args().map(|arg| arg.to_string_lossy().into_owned()).collect::<Vec<_>>();
        let config_flag = args.iter().position(|arg| arg == "--config");
        assert!(config_flag.is_some_and(|index| args.get(index + 1).is_some_and(|arg| arg == "-")));
        assert!(args.iter().all(|arg| !arg.contains(secret_value)));
        assert!(!format!("{command:?}").contains(secret_value));
    }

    #[test]
    fn status_split_accepts_only_three_digit_http_codes() {
        assert_eq!(split_status(b"{\"ok\":true}\nUNDESIGN_HTTP_STATUS:200"), Ok((&b"{\"ok\":true}"[..], 200)));
        assert!(split_status(b"body\nUNDESIGN_HTTP_STATUS:20x").is_err());
    }
}
