/**
 * Python import names are not PyPI distribution names. `import yaml` installs
 * `PyYAML`, `import cv2` installs `opencv-python`. Checking the import name
 * against the registry would report these as hallucinated packages, so the
 * well-known mismatches are mapped before any lookup happens.
 */
export const PY_IMPORT_TO_DISTRIBUTION: Readonly<Record<string, string>> = {
  attr: "attrs",
  bs4: "beautifulsoup4",
  Bio: "biopython",
  Crypto: "pycryptodome",
  Cryptodome: "pycryptodomex",
  cairo: "pycairo",
  concurrent_log_handler: "concurrent-log-handler",
  confluent_kafka: "confluent-kafka",
  cpuinfo: "py-cpuinfo",
  cv2: "opencv-python",
  dateutil: "python-dateutil",
  discord: "discord.py",
  dns: "dnspython",
  docx: "python-docx",
  dotenv: "python-dotenv",
  fitz: "PyMuPDF",
  flask_cors: "Flask-Cors",
  flask_jwt_extended: "Flask-JWT-Extended",
  flask_login: "Flask-Login",
  flask_migrate: "Flask-Migrate",
  flask_sqlalchemy: "Flask-SQLAlchemy",
  git: "GitPython",
  github: "PyGithub",
  gitlab: "python-gitlab",
  gi: "PyGObject",
  grpc: "grpcio",
  grpc_tools: "grpcio-tools",
  IPython: "ipython",
  jose: "python-jose",
  jwt: "PyJWT",
  kafka: "kafka-python",
  magic: "python-magic",
  MySQLdb: "mysqlclient",
  mpl_toolkits: "matplotlib",
  multipart: "python-multipart",
  nacl: "PyNaCl",
  OpenGL: "PyOpenGL",
  OpenSSL: "pyOpenSSL",
  PIL: "Pillow",
  pkg_resources: "setuptools",
  pptx: "python-pptx",
  psycopg2: "psycopg2-binary",
  pythonjsonlogger: "python-json-logger",
  requests_toolbelt: "requests-toolbelt",
  serial: "pyserial",
  skimage: "scikit-image",
  sklearn: "scikit-learn",
  slack_sdk: "slack-sdk",
  slugify: "python-slugify",
  socks: "PySocks",
  telegram: "python-telegram-bot",
  usb: "pyusb",
  win32api: "pywin32",
  win32com: "pywin32",
  win32con: "pywin32",
  win32file: "pywin32",
  wx: "wxPython",
  yaml: "PyYAML",
  zoneinfo: "backports.zoneinfo",
};

/**
 * Namespace roots shared by many distributions. A single import name cannot be
 * attributed to one package, so they are never checked.
 */
export const PY_AMBIGUOUS_NAMESPACES: ReadonlySet<string> = new Set([
  "azure",
  "backports",
  "google",
  "jaraco",
  "mypy_extensions",
  "paste",
  "pkgutil",
  "repoze",
  "ruamel",
  "sphinxcontrib",
  "zc",
  "zope",
]);

/**
 * The PyPI distribution to verify for a top-level import name.
 * Returns undefined when the name cannot be attributed to one distribution.
 */
export function pypiDistributionForImport(
  importName: string,
): string | undefined {
  if (PY_AMBIGUOUS_NAMESPACES.has(importName)) return undefined;
  return PY_IMPORT_TO_DISTRIBUTION[importName] ?? importName;
}
