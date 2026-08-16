import os
import io
import time
import uuid
import json
import mimetypes
import subprocess
import platform
from flask import Flask, render_template, send_file, request, redirect, url_for, session

# Google API Imports
from google.oauth2.credentials import Credentials
from google_auth_oauthlib.flow import Flow
from google.auth.exceptions import RefreshError
from googleapiclient.discovery import build
from googleapiclient.http import MediaIoBaseDownload
from googleapiclient.errors import HttpError

# CBZ Library Import
from cbz import ComicInfo

# ================= CONFIGURATION =================
BASE_DIR = os.path.abspath(os.path.dirname(__file__))

# Auto-detect OS for 7-Zip
if platform.system() == "Windows":
    SEVENZIP_EXE = r"C:\Program Files\7-Zip\7z.exe"
else:
    SEVENZIP_EXE = "7z"  # Standard command on Linux via p7zip-full

CACHE_DIR = os.path.join(BASE_DIR, 'cache')
if not os.path.exists(CACHE_DIR):
    os.makedirs(CACHE_DIR)

SCOPES = ['https://www.googleapis.com/auth/drive.readonly']
CLIENT_SECRETS_FILE = os.path.join(BASE_DIR, "client_secret.json")
# =================================================

app = Flask(__name__)
# Get secret key from environment, fallback to hardcoded for local testing
app.secret_key = os.environ.get("FLASK_SECRET_KEY", "my_super_secret_comic_key_change_me")

# ONLY allow insecure HTTP for local testing
if os.environ.get("FLASK_ENV") == "development":
    os.environ['OAUTHLIB_INSECURE_TRANSPORT'] = '1'

# --- HELPER FUNCS ---

def get_oauth_flow(state=None):
    """Loads Google config from Render Env Var, falls back to local JSON file"""
    client_secrets_env = os.environ.get("GOOGLE_CLIENT_SECRET_JSON")
    
    if client_secrets_env:
        client_config = json.loads(client_secrets_env)
        return Flow.from_client_config(
            client_config, scopes=SCOPES, state=state,
            redirect_uri=url_for('oauth2callback', _external=True)
        )
    else:
        if not os.path.exists(CLIENT_SECRETS_FILE):
            raise FileNotFoundError(f"Missing client secrets. Set GOOGLE_CLIENT_SECRET_JSON env var or provide {CLIENT_SECRETS_FILE}")
        return Flow.from_client_secrets_file(
            CLIENT_SECRETS_FILE, scopes=SCOPES, state=state,
            redirect_uri=url_for('oauth2callback', _external=True)
        )

class SevenZipPage:
    def __init__(self, archive_path, name):
        self.archive_path = archive_path
        self.name = name

    @property
    def content(self):
        cmd = [SEVENZIP_EXE, 'e', self.archive_path, self.name, '-so']
        result = subprocess.run(cmd, capture_output=True)
        return result.stdout

class SevenZipComic:
    def __init__(self, filepath):
        self.filepath = filepath
        cmd = [SEVENZIP_EXE, 'l', '-ba', '-slt', self.filepath]
        result = subprocess.run(cmd, capture_output=True, text=True, encoding='utf-8', errors='ignore')
        
        files = []
        for line in result.stdout.splitlines():
            if line.startswith("Path = "):
                files.append(line.split("Path = ", 1)[1])
                
        valid_exts = ('.png', '.jpg', '.jpeg', '.gif', '.webp')
        self.images = sorted([f for f in files if f.lower().endswith(valid_exts)])

    def __len__(self):
        return len(self.images)

    def __getitem__(self, index):
        if index < 0 or index >= len(self.images):
            raise IndexError("Page out of range")
        return SevenZipPage(self.filepath, self.images[index])


def get_drive_service():
    if 'credentials' not in session:
        return None
    creds_data = session['credentials']
    creds = Credentials(
        token=creds_data['token'],
        refresh_token=creds_data.get('refresh_token'),
        token_uri=creds_data.get('token_uri'),
        client_id=creds_data.get('client_id'),
        client_secret=creds_data.get('client_secret'),
        scopes=creds_data.get('scopes')
    )
    return build('drive', 'v3', credentials=creds)

def fetch_all_items(service, query, fields):
    items = []
    page_token = None
    while True:
        results = service.files().list(
            q=query, fields=f"nextPageToken, {fields}",
            orderBy="folder, name", pageToken=page_token, pageSize=1000
        ).execute()
        items.extend(results.get('files', []))
        page_token = results.get('nextPageToken')
        if not page_token:
            break
    return items

def get_or_download_comic(file_id, service):
    metadata = service.files().get(fileId=file_id, fields="id, name").execute()
    filename = metadata['name']
    ext = os.path.splitext(filename)[1].lower()
    local_path = os.path.join(CACHE_DIR, f"{file_id}{ext}")
    
    if not os.path.exists(local_path):
        temp_path = f"{local_path}.{uuid.uuid4().hex}.tmp"
        request = service.files().get_media(fileId=file_id, acknowledgeAbuse=True)
        
        with io.FileIO(temp_path, 'wb') as fh:
            downloader = MediaIoBaseDownload(fh, request)
            done = False
            while not done:
                status, done = downloader.next_chunk()
                    
        retries = 10
        while retries > 0:
            try:
                if not os.path.exists(local_path): 
                    os.rename(temp_path, local_path)
                else:
                    if os.path.exists(temp_path):
                        os.remove(temp_path)
                break
            except (PermissionError, FileExistsError):
                time.sleep(0.5)
                retries -= 1
                if retries == 0:
                    raise
    return local_path, filename, ext

def load_comic_info(local_path, ext):
    if ext == '.cbr': 
        return SevenZipComic(local_path)
    elif ext == '.pdf': 
        return ComicInfo.from_pdf(local_path)
    else: 
        return ComicInfo.from_cbz(local_path)

# --- ROUTES ---

@app.route('/login')
def login():
    try:
        flow = get_oauth_flow()
    except Exception as e:
        return f"Server Configuration Error: {str(e)}", 500
        
    authorization_url, state = flow.authorization_url(
        access_type='offline', include_granted_scopes='true', prompt='consent')
        
    session['state'] = state
    if hasattr(flow, 'code_verifier'):
        session['code_verifier'] = flow.code_verifier
        
    return redirect(authorization_url)

@app.route('/oauth2callback')
def oauth2callback():
    state = session.get('state')
    if not state: return redirect(url_for('login'))
        
    flow = get_oauth_flow(state=state)
    if 'code_verifier' in session:
        flow.code_verifier = session['code_verifier']
        
    flow.fetch_token(authorization_response=request.url)
    creds = flow.credentials
    session['credentials'] = {
        'token': creds.token, 'refresh_token': creds.refresh_token,
        'token_uri': creds.token_uri, 'client_id': creds.client_id,
        'client_secret': creds.client_secret, 'scopes': creds.scopes
    }
    return redirect(url_for('index'))

@app.route('/logout')
def logout():
    session.clear()
    return "Logged out successfully. <a href='/'>Go Home</a>"

@app.route('/')
def index():
    if 'library_root_id' not in session:
        return redirect(url_for('picker', folder_id='root'))
    return redirect(url_for('browse', folder_id=session['library_root_id']))

@app.route('/picker/<folder_id>')
def picker(folder_id):
    service = get_drive_service()
    if not service: return redirect(url_for('login'))

    try:
        if folder_id == 'root':
            folder = {'name': 'My Drive', 'parents': []}
        else:
            folder = service.files().get(fileId=folder_id, fields="id, name, parents").execute()
            
        query = f"'{folder_id}' in parents and trashed = false and mimeType = 'application/vnd.google-apps.folder'"
        folders = fetch_all_items(service, query, "files(id, name)")
        
    except (RefreshError, HttpError):
        session.clear()
        return redirect(url_for('login'))
    
    parents = folder.get('parents', [])
    parent_id = parents[0] if parents else None
    
    return render_template('picker.html', folder_id=folder_id, folder_name=folder['name'], parent_id=parent_id, folders=folders)

@app.route('/set_root/<folder_id>')
def set_root(folder_id):
    session['library_root_id'] = folder_id
    return redirect(url_for('index'))

@app.route('/browse/<folder_id>')
def browse(folder_id):
    service = get_drive_service()
    if not service: return redirect(url_for('login'))

    try:
        if folder_id == 'root':
            folder = {'name': 'My Drive', 'parents': []}
        else:
            folder = service.files().get(fileId=folder_id, fields="id, name, parents").execute()

        query = f"'{folder_id}' in parents and trashed = false"
        items = fetch_all_items(service, query, "files(id, name, mimeType)")
        
    except (RefreshError, HttpError):
        session.clear()
        return redirect(url_for('login'))
    
    folders, comics = [], []
    for item in items:
        if item['mimeType'] == 'application/vnd.google-apps.folder':
            folders.append(item)
        elif item['name'].lower().endswith(('.cbz', '.cbr', '.pdf')):
            comics.append(item)

    folders.sort(key=lambda x: x['name'].lower())
    comics.sort(key=lambda x: x['name'].lower())
    
    parents = folder.get('parents', [])
    parent_id = parents[0] if parents else None
    
    return render_template('browser.html', folder_id=folder_id, folder_name=folder['name'], parent_id=parent_id, folders=folders, comics=comics, library_root_id=session.get('library_root_id'))

@app.route('/read/<file_id>')
def read(file_id):
    service = get_drive_service()
    if not service: return redirect(url_for('login'))
        
    try:
        local_path, filename, ext = get_or_download_comic(file_id, service)
        try:
            comic = load_comic_info(local_path, ext)
            num_pages = len(comic)
        except Exception as e:
            if os.path.exists(local_path): os.remove(local_path)
            return f"<h1>Cache file corrupted. Deleted!</h1><p>Refresh to re-download.</p><p>Error: {str(e)}</p>", 500
            
        metadata = service.files().get(fileId=file_id, fields="parents").execute()
        parents = metadata.get('parents', [])
        parent_id = parents[0] if parents else session.get('library_root_id', 'root')
        
    except (RefreshError, HttpError):
        session.clear()
        return redirect(url_for('login'))
        
    back_url = url_for('browse', folder_id=parent_id)
    return render_template('reader.html', images=list(range(num_pages)), comic_name=filename, file_id=file_id, back_url=back_url)

@app.route('/image')
def serve_image():
    file_id = request.args.get('file_id')
    page_index = request.args.get('page_index')
    if file_id is None or page_index is None: return "Missing param", 400
        
    service = get_drive_service()
    if not service: return "Not authenticated", 401
        
    try:
        metadata = service.files().get(fileId=file_id, fields="name").execute()
        ext = os.path.splitext(metadata['name'])[1].lower()
        local_path = os.path.join(CACHE_DIR, f"{file_id}{ext}")
        
        if not os.path.exists(local_path):
            local_path, _, ext = get_or_download_comic(file_id, service)
            
        comic = load_comic_info(local_path, ext)
        page = comic[int(page_index)]
        filename = getattr(page, 'name', f"page_{page_index}.jpg")
        mimetype, _ = mimetypes.guess_type(filename)
        
        return send_file(io.BytesIO(page.content), mimetype=mimetype or 'image/jpeg')
    except Exception as e:
        return f"Failed to serve image: {e}", 500

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000)