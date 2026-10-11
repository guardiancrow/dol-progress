use sha2::{Digest, Sha256};
use std::{error::Error, fmt};

pub const CANONICAL_VERSION: u32 = 1;
const MAX_BODY_BYTES: usize = 128 * 1024;
const MAX_DOCUMENT_BYTES: usize = 2 * 1024 * 1024;

#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub struct TermsVersion(u32);

impl TermsVersion {
    pub fn new(value: u32) -> Result<Self, CanonicalError> {
        if value == 0 {
            Err(CanonicalError::InvalidVersion)
        } else {
            Ok(Self(value))
        }
    }

    /// 表示用versionの曖昧な表記を受け入れない。
    pub fn parse(value: &str) -> Result<Self, CanonicalError> {
        if value.is_empty() || value.starts_with('0') || !value.bytes().all(|b| b.is_ascii_digit())
        {
            return Err(CanonicalError::InvalidVersion);
        }
        Self::new(value.parse().map_err(|_| CanonicalError::InvalidVersion)?)
    }

    pub fn get(self) -> u32 {
        self.0
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct CanonicalTerms {
    version: TermsVersion,
    text: String,
    sha256: String,
}

impl CanonicalTerms {
    /// 本文のみの入力。文書先頭のBOMとCRLFを正規化する。
    pub fn from_body(version: TermsVersion, bytes: &[u8]) -> Result<Self, CanonicalError> {
        if bytes.len() > MAX_BODY_BYTES * 2 + 3 {
            return Err(CanonicalError::TooLarge);
        }
        Self::from_normalized(version, &normalize_document(bytes)?)
    }

    /// 将来のREADME/README.txt対応用。現在のREADMEを自動探索しない。
    pub fn from_readme(version: TermsVersion, bytes: &[u8]) -> Result<Self, CanonicalError> {
        if bytes.len() > MAX_DOCUMENT_BYTES {
            return Err(CanonicalError::TooLarge);
        }
        let document = normalize_document(bytes)?;
        let lines: Vec<_> = document.lines().collect();
        let license: Vec<_> = lines
            .iter()
            .enumerate()
            .filter(|(_, line)| **line == "## License")
            .map(|(index, _)| index)
            .collect();
        let terms: Vec<_> = lines
            .iter()
            .enumerate()
            .filter(|(_, line)| **line == "### 利用条件")
            .map(|(index, _)| index)
            .collect();
        if license.len() != 1 || terms.len() != 1 {
            return Err(CanonicalError::HeadingBoundary);
        }
        let start = terms[0];
        let license_end = (license[0] + 1..lines.len())
            .find(|&index| heading_level(lines[index]).is_some_and(|level| level <= 2))
            .unwrap_or(lines.len());
        if start <= license[0] || start >= license_end {
            return Err(CanonicalError::HeadingBoundary);
        }
        let end = (start + 1..license_end)
            .find(|&index| heading_level(lines[index]).is_some_and(|level| level <= 3))
            .unwrap_or(license_end);
        // 文書内のBOMはここで再除去せず、最初のdecodeだけに限定する。
        Self::from_normalized(version, &lines[start + 1..end].join("\n"))
    }

    fn from_normalized(version: TermsVersion, text: &str) -> Result<Self, CanonicalError> {
        let body = text.trim_matches('\n');
        if body.trim().is_empty() {
            return Err(CanonicalError::EmptyBody);
        }
        if body.chars().any(|c| c.is_control() && c != '\n') {
            return Err(CanonicalError::ControlCharacter);
        }
        if body.lines().any(forbidden_markup) {
            return Err(CanonicalError::UnsupportedMarkup);
        }
        let canonical = format!("{body}\n");
        if canonical.len() > MAX_BODY_BYTES {
            return Err(CanonicalError::TooLarge);
        }
        let sha256 = format!("{:x}", Sha256::digest(canonical.as_bytes()));
        Ok(Self {
            version,
            text: canonical,
            sha256,
        })
    }

    pub fn version(&self) -> TermsVersion {
        self.version
    }

    pub fn text(&self) -> &str {
        &self.text
    }

    pub fn bytes(&self) -> &[u8] {
        self.text.as_bytes()
    }

    pub fn sha256(&self) -> &str {
        &self.sha256
    }
}

fn normalize_document(bytes: &[u8]) -> Result<String, CanonicalError> {
    let text = std::str::from_utf8(bytes).map_err(|_| CanonicalError::InvalidUtf8)?;
    let normalized = text
        .strip_prefix('\u{feff}')
        .unwrap_or(text)
        .replace("\r\n", "\n");
    if normalized.contains('\r') {
        return Err(CanonicalError::LoneCarriageReturn);
    }
    Ok(normalized)
}

fn heading_level(line: &str) -> Option<usize> {
    let level = line.bytes().take_while(|b| *b == b'#').count();
    (level > 0 && line.as_bytes().get(level) == Some(&b' ')).then_some(level)
}

fn forbidden_markup(line: &str) -> bool {
    let trimmed = line.trim_start();
    if trimmed.starts_with(['#', '-', '+', '>'])
        || trimmed.split_once(". ").is_some_and(|(prefix, _)| {
            !prefix.is_empty() && prefix.bytes().all(|b| b.is_ascii_digit())
        })
    {
        return true;
    }
    line.split_whitespace().any(|word| {
        if word.contains(['`', '[', ']', '<', '>', '|']) {
            return true;
        }
        if word.starts_with("https://") {
            return false;
        }
        if word.contains('*') {
            return true;
        }
        let chars: Vec<_> = word.chars().collect();
        chars.iter().enumerate().any(|(index, c)| {
            *c == '_'
                && !(index > 0
                    && index + 1 < chars.len()
                    && chars[index - 1].is_alphanumeric()
                    && chars[index + 1].is_alphanumeric())
        })
    })
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum CanonicalError {
    InvalidVersion,
    InvalidUtf8,
    LoneCarriageReturn,
    EmptyBody,
    ControlCharacter,
    UnsupportedMarkup,
    HeadingBoundary,
    TooLarge,
}

impl fmt::Display for CanonicalError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "利用条件本文を正規化できません: {self:?}")
    }
}

impl Error for CanonicalError {}
