// Section Map plugin
// Shows a minimap bar of the full song structure with clickable sections.

let _smBar = null;
let _smSections = [];
let _smDuration = 0;
let _smMarker = null;
let _smBlocks = [];
let _smActiveIdx = -1;
let _smIntervalId = null;

const SM_COLORS = {
    'intro': '#3b82f6',
    'verse': '#22c55e',
    'chorus': '#eab308',
    'bridge': '#a855f7',
    'solo': '#ef4444',
    'outro': '#6b7280',
    'breakdown': '#f97316',
    'riff': '#06b6d4',
    'pre': '#84cc16',
    'noguitar': '#374151',
    'default': '#4b5563',
};

function _smGetColor(name) {
    const low = name.toLowerCase();
    for (const [key, color] of Object.entries(SM_COLORS)) {
        if (low.includes(key)) return color;
    }
    return SM_COLORS.default;
}

function _smCreate() {
    if (_smBar) return;
    const player = document.getElementById('player');
    if (!player) return;

    _smBar = document.createElement('div');
    _smBar.id = 'section-map';
    _smBar.style.cssText = 'position:absolute;top:0;left:0;right:0;z-index:5;height:20px;background:rgba(8,8,16,0.7);cursor:pointer;';

    // Insert as first child of player (very top)
    player.insertBefore(_smBar, player.firstChild);

    _smBar.addEventListener('click', _smOnClick);
    _smBar.addEventListener('wheel', _smOnWheel, { passive: false });
}

function _smRemove() {
    if (_smIntervalId !== null) {
        clearInterval(_smIntervalId);
        _smIntervalId = null;
    }
    if (_smBar) {
        _smBar.remove();
        _smBar = null;
    }
    _smMarker = null;
    _smBlocks = [];
    _smActiveIdx = -1;
}

function _smOnClick(e) {
    if (!_smDuration) return;
    const rect = _smBar.getBoundingClientRect();
    const pct = (e.clientX - rect.left) / rect.width;
    const time = pct * _smDuration;
    const audio = document.getElementById('audio');
    if (!audio) return;

    // Update lastAudioTime to prevent the jump detector from resetting
    if (typeof lastAudioTime !== 'undefined') lastAudioTime = time;

    // Pause, seek, then resume — seeking during playback fails on unbuffered regions
    const wasPlaying = !audio.paused;
    if (wasPlaying) audio.pause();
    audio.currentTime = Math.max(0, time);
    if (wasPlaying) {
        audio.addEventListener('seeked', function resume() {
            audio.removeEventListener('seeked', resume);
            audio.play();
        }, { once: true });
    }
}

function _smOnWheel(e) {
    if (!_smDuration) return;
    e.preventDefault();

    const audio = document.getElementById('audio');
    if (!audio) return;

    // Calculate time delta: up (negative deltaY) = forward, down (positive deltaY) = backward
    const increment = e.ctrlKey ? 0.1 : 1; // Fine control with Ctrl modifier
    const deltaTime = -(e.deltaY > 0 ? 1 : -1) * increment; // Negate to match scroll direction to time direction
    const newTime = Math.max(0, Math.min(_smDuration, audio.currentTime + deltaTime));

    // Update lastAudioTime to prevent the jump detector from resetting
    if (typeof lastAudioTime !== 'undefined') lastAudioTime = newTime;

    // Pause, seek, then resume — seeking during playback fails on unbuffered regions
    const wasPlaying = !audio.paused;
    if (wasPlaying) audio.pause();
    audio.currentTime = newTime;
    if (wasPlaying) {
        audio.addEventListener('seeked', function resume() {
            audio.removeEventListener('seeked', resume);
            audio.play();
        }, { once: true });
    }
}

function _smUpdate() {
    if (!_smBar) return;
    const sections = highway.getSections();
    const t = highway.getTime();

    if (!sections || sections.length === 0 || !_smDuration) return;

    // Only rebuild if sections changed (guard with length to handle new-array-same-content)
    if (sections !== _smSections || sections.length !== _smSections.length) {
        _smSections = sections;
        _smRender();
    }

    // Update playback position indicator via transform — compositor only, no layout
    if (_smMarker && _smDuration > 0) {
        const pct = (t / _smDuration) * 100;
        _smMarker.style.transform = `translateX(${pct}%)`;
    }

    // Highlight active section — skip if active index unchanged
    let newIdx = 0;
    for (let i = 0; i < _smSections.length; i++) {
        if (_smSections[i].time <= t) newIdx = i;
        else break;
    }
    if (newIdx !== _smActiveIdx) {
        _smActiveIdx = newIdx;
        _smBlocks.forEach((block, i) => {
            block.style.opacity = i === newIdx ? '1' : '0.5';
        });
    }
}

function _smRender() {
    if (!_smBar || !_smSections.length || !_smDuration) return;

    let html = '';

    for (let i = 0; i < _smSections.length; i++) {
        const sec = _smSections[i];
        const nextTime = i < _smSections.length - 1 ? _smSections[i + 1].time : _smDuration;
        const startPct = (sec.time / _smDuration) * 100;
        const widthPct = ((nextTime - sec.time) / _smDuration) * 100;
        const color = _smGetColor(sec.name);

        // Clean up section name for display
        let label = sec.name.replace(/\d+$/, '').trim();
        label = label.charAt(0).toUpperCase() + label.slice(1);

        html += `<div class="sm-block" style="position:absolute;left:${startPct}%;width:${widthPct}%;top:0;bottom:0;background:${color};border-right:1px solid rgba(0,0,0,0.3);display:flex;align-items:center;justify-content:center;overflow:hidden;transition:opacity 0.15s;"
            title="${label} (${_smFmt(sec.time)})">
            <span style="font-size:9px;color:rgba(255,255,255,0.8);white-space:nowrap;text-overflow:ellipsis;overflow:hidden;padding:0 3px;">${label}</span>
        </div>`;
    }

    // Marker: left:0 + translateX(pct%) keeps it on compositor layer
    html += '<div id="sm-marker" style="position:absolute;top:0;bottom:0;left:0;width:2px;background:white;z-index:1;pointer-events:none;transition:transform 0.1s linear;"></div>';

    _smBar.innerHTML = html;
    _smBar.style.position = 'relative';

    // Cache refs so _smUpdate never queries the DOM
    _smMarker = document.getElementById('sm-marker');
    _smBlocks = Array.from(_smBar.querySelectorAll('.sm-block'));
    _smActiveIdx = -1; // force opacity update on next tick
}

function _smFmt(s) {
    return Math.floor(s / 60) + ':' + String(Math.floor(s % 60)).padStart(2, '0');
}

// Side effects: poller + playSong/showScreen wrappers. Consolidated under
// one idempotency guard so re-evaluation (loader cache miss, hot reload,
// older core builds without the load-side guard) doesn't start a second
// 5Hz poller and doesn't grow either wrapper chain.
(function() {
    const HOOK_KEY = '__slopsmithSectionMapHooksInstalled';
    if (window[HOOK_KEY]) return;
    window[HOOK_KEY] = true;

    // Hook into playSong
    const origPlaySong = window.playSong;
    window.playSong = async function(filename, arrangement) {
        _smRemove();
        _smSections = [];
        _smDuration = 0;
        await origPlaySong(filename, arrangement);
        const info = highway.getSongInfo();
        _smDuration = info.duration;
        _smCreate();
        // Start polling only while player is active
        _smIntervalId = setInterval(_smUpdate, 200);
    };

    // Clean up when leaving player
    const origShowScreen = window.showScreen;
    window.showScreen = function(id) {
        if (id !== 'player') _smRemove();
        origShowScreen(id);
    };
})();
