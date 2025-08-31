// LIVE OVERLAY CONFIGURATION
const OVERLAY_DURATION = 4000
const OVERLAY_FADE_DURATION = 500
const MAX_CONCURRENT_OVERLAYS = 3
const OVERLAY_SPACING = 0
const TIME_TOLERANCE = 0.5

let timeComments = []
let activeOverlays = []
let lastVideoTime = 0
let overlayContainer = null

main()
onLocationHrefChange(() => {
    removeBar()
    removeOverlayContainer()
    timeComments = []
    activeOverlays = []
    main()
})

function main() {
    const videoId = getVideoId()
    if (!videoId) return

    fetchTimeComments(videoId)
        .then(comments => {
            if (videoId === getVideoId()) {
                timeComments = comments
                addTimeComments(comments)
                startVideoTimeMonitoring()
            }
        })
}

function parseParams(href) {
    const paramString = href.split('#')[0].split('?')[1]
    const params = {}

    if (paramString) {
        for (const kv of paramString.split('&')) {
            const [key, value] = kv.split('=')
            params[key] = value
        }
    }
    return params
}

function getVideoId() {
    if (window.location.pathname === '/watch') {
        return parseParams(window.location.href)['v']
    } else if (window.location.pathname.startsWith('/embed/')) {
        return window.location.pathname.substring('/embed/'.length)
    }
    return null
}

function getVideo() {
    return document.querySelector('#movie_player video')
}

function fetchTimeComments(videoId) {
    return new Promise((resolve) => {
        chrome.runtime.sendMessage({type: 'fetchTimeComments', videoId}, resolve)
    })
}

function startVideoTimeMonitoring() {
    const video = getVideo()
    if (!video) return

    video.removeEventListener('timeupdate', handleTimeUpdate)
    video.addEventListener('timeupdate', handleTimeUpdate)
}

function handleTimeUpdate(event) {
    const video = event.target
    const currentTime = video.currentTime

    if (video.paused || Math.abs(currentTime - lastVideoTime) < 0.1) {
        lastVideoTime = currentTime
        return
    }

    const commentsToShow = timeComments.filter(tc => {
        const timeDiff = Math.abs(tc.time - currentTime)
        return timeDiff <= TIME_TOLERANCE && !isCommentCurrentlyShown(tc)
    })

    commentsToShow.forEach(showLiveOverlay)
    lastVideoTime = currentTime
}

function isCommentCurrentlyShown(comment) {
    return activeOverlays.some(overlay =>
        overlay.commentId === comment.commentId &&
        overlay.timestamp === comment.timestamp
    )
}

function showLiveOverlay(timeComment) {
    if (activeOverlays.length >= MAX_CONCURRENT_OVERLAYS) {
        const oldestOverlay = activeOverlays.shift()
        removeOverlay(oldestOverlay)
    }

    const container = getOrCreateOverlayContainer()
    const overlay = createOverlayElement(timeComment)

    const yPosition = calculateOverlayYPosition()
    overlay.style.top = yPosition + 'px'

    container.appendChild(overlay)

    const overlayData = {
        element: overlay,
        commentId: timeComment.commentId,
        timestamp: timeComment.timestamp,
        startTime: Date.now()
    }
    activeOverlays.push(overlayData)

    requestAnimationFrame(() => {
        overlay.style.opacity = '1'
        overlay.style.transform = 'translateX(0)'
    })

    setTimeout(() => {
        removeOverlay(overlayData)
    }, OVERLAY_DURATION)
}

function calculateOverlayYPosition() {
    const baseY = 80
    const usedPositions = activeOverlays.map(overlay =>
        parseInt(overlay.element.style.top) || 0
    )

    for (let i = 0; i < MAX_CONCURRENT_OVERLAYS; i++) {
        const yPos = baseY + (i * OVERLAY_SPACING)
        if (!usedPositions.includes(yPos)) {
            return yPos
        }
    }

    return baseY
}

function removeOverlay(overlayData) {
    if (!overlayData || !overlayData.element) return

    const overlay = overlayData.element

    overlay.style.opacity = '0'
    overlay.style.transform = 'translateX(100px)'

    setTimeout(() => {
        if (overlay.parentNode) {
            overlay.parentNode.removeChild(overlay)
        }
    }, OVERLAY_FADE_DURATION)

    const index = activeOverlays.indexOf(overlayData)
    if (index > -1) {
        activeOverlays.splice(index, 1)
    }
}

function formatCommentTextWithTimestampSpans(text) {
  const frag = document.createDocumentFragment();
  if (!text) return frag;
  const regex = /(\d?\d:)?(\d?\d:)\d\d/g;
  let lastIndex = 0;
  let match;
  while ((match = regex.exec(text)) !== null) {
    const from = match.index;
    const to = regex.lastIndex;
    if (from > lastIndex) {
      frag.appendChild(document.createTextNode(text.slice(lastIndex, from)));
    }
    const ts = text.slice(from, to);
    const span = document.createElement('span');
    span.className = '__youtube-timestamps__live-overlay__text-stamp';
    span.textContent = ts;
    span.setAttribute('role', 'button');
    span.tabIndex = 0;
    span.addEventListener('click', (ev) => {
      ev.stopPropagation();
      const secs = parseTimestampToSeconds(ts);
      const video = getVideo && getVideo();
      if (video && secs != null) {
        video.currentTime = Math.max(0, Math.min(video.duration || Infinity, secs));
        video.play().catch(()=>{});
      }
    });
    span.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter' || ev.key === ' ') {
        ev.preventDefault();
        span.click();
      }
    });
    frag.appendChild(span);
    lastIndex = to;
  }
  if (lastIndex < text.length) {
    frag.appendChild(document.createTextNode(text.slice(lastIndex)));
  }
  return frag;
}

const __yt_overlay_queue = [];
let __yt_active_overlays = 0;

function getOrCreateOverlayStackContainer() {
  let container = document.querySelector('.__youtube-timestamps__overlay-stack');
  if (!container) {
    container = document.createElement('div');
    container.className = '__youtube-timestamps__overlay-stack';
    const player = document.querySelector('.html5-video-player') || document.querySelector('#player') || document.body;
    player.appendChild(container);
  }
  return container;
}

function showOverlayForCommentQueued(timeComment) {
  __yt_overlay_queue.push(timeComment);
  processOverlayQueue();
}

function processOverlayQueue() {
  if (__yt_active_overlays >= MAX_CONCURRENT) return;
  if (__yt_overlay_queue.length === 0) return;

  const next = __yt_overlay_queue.shift();
  displayOverlayImmediate(next);
}

function displayOverlayImmediate(timeComment) {
  const container = getOrCreateOverlayStackContainer();
  const overlay = createOverlayElement(timeComment);

  // append to container
  container.appendChild(overlay);

  // mark active
  __yt_active_overlays++;

  // animate show
  requestAnimationFrame(() => overlay.classList.add('show'));

  // schedule removal
  const removeAfter = OVERLAY_DURATION;
  const hideDelay = 260; // allow CSS fade-out time (ms)
  const removalTimer = setTimeout(() => {
    overlay.classList.remove('show');
    overlay.classList.add('hide');

    setTimeout(() => {
      // cleanup DOM
      if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
      __yt_active_overlays = Math.max(0, __yt_active_overlays - 1);
      // show next in queue if any
      processOverlayQueue();
    }, hideDelay);
  }, removeAfter);
}

function parseTimestampToSeconds(ts) {
  if (!ts || typeof ts !== 'string') return null;
  const parts = ts.split(':').map(p => parseInt(p, 10));
  if (parts.some(p => Number.isNaN(p))) return null;
  if (parts.length === 1) return parts[0];
  if (parts.length === 2) {
    const [m, s] = parts;
    if (s > 59) return null;
    return m * 60 + s;
  }
  const last3 = parts.slice(-3);
  const [h, m, s] = last3;
  if (s > 59 || m > 59) return null;
  return h * 3600 + m * 60 + s;
}

function formatSecondsToHMS(sec) {
  if (typeof sec !== 'number' || Number.isNaN(sec)) return '';
  sec = Math.floor(sec);
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  if (h > 0) return `${h}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
  return `${m}:${String(s).padStart(2,'0')}`;
}

function createOverlayElement(timeComment) {
  const overlay = document.createElement('div');
  overlay.className = '__youtube-timestamps__live-overlay';

  // Avatar
  const avatar = document.createElement('img');
  avatar.className = '__youtube-timestamps__live-overlay__avatar';
  avatar.alt = timeComment.authorName || 'User';
  avatar.src = timeComment.authorAvatar || '';

  // Content
  const content = document.createElement('div');
  content.className = '__youtube-timestamps__live-overlay__content';

  const authorName = document.createElement('div');
  authorName.className = '__youtube-timestamps__live-overlay__author';
  authorName.textContent = timeComment.authorName || 'Unknown';

  const commentText = document.createElement('div');
  commentText.className = '__youtube-timestamps__live-overlay__text';
  commentText.appendChild(formatCommentTextWithTimestampSpans(timeComment.text || ''));

  content.appendChild(authorName);
  content.appendChild(commentText);

  overlay.appendChild(avatar);
  overlay.appendChild(content);

  // Make overlay clickable: seek to the primary time for this comment (if available)
  overlay.addEventListener('click', (ev) => {
    ev.preventDefault();
    ev.stopPropagation();
    const video = getVideo && getVideo();
    // prefer explicit numeric time if provided, otherwise try parse from .timestamp
    const secs = (typeof timeComment.time === 'number') ? timeComment.time : parseTimestampToSeconds(timeComment.timestamp || '');
    if (video && secs != null) {
      video.currentTime = Math.max(0, Math.min(video.duration || Infinity, secs));
      video.play().catch(()=>{});
    }
  });

  // keyboard accessible
  overlay.tabIndex = 0;

  return overlay;
}

function showOverlayForComment(timeComment) {
  const container = getOrCreateOverlayStackContainer();
  const overlay = createOverlayElement(timeComment);

  // Append overlay as the last child -> stacks under existing ones
  container.appendChild(overlay);

  // allow CSS animation (add 'show' after appending)
  requestAnimationFrame(() => {
    overlay.classList.add('show');
  });

  // Remove overlay after duration (fade out then remove)
  const removeAfter = OVERLAY_DURATION;
  setTimeout(() => {
    overlay.classList.remove('show');
    overlay.classList.add('hide');
    // give fade animation time (match CSS transition)
    setTimeout(() => {
      if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
    }, 280);
  }, removeAfter);

  return overlay;
}

function getOrCreateOverlayContainer() {
    if (!overlayContainer) {
        overlayContainer = document.createElement('div')
        overlayContainer.classList.add('__youtube-timestamps__overlay-container')

        const player = document.querySelector('#movie_player')
        if (player) {
            player.appendChild(overlayContainer)
        }
    }
    return overlayContainer
}

function removeOverlayContainer() {
    if (overlayContainer) {
        overlayContainer.remove()
        overlayContainer = null
    }
    activeOverlays = []
}

function addTimeComments(timeComments) {
    const bar = getOrCreateBar()
    const videoDuration = getVideo().duration
    const groupedComments = new Map()

    for (const tc of timeComments) {
        if (typeof tc.time !== 'number' || tc.time > videoDuration) continue

        const timeKey = tc.time.toString()
        if (!groupedComments.has(timeKey)) {
            groupedComments.set(timeKey, [])
        }
        groupedComments.get(timeKey).push(tc)
    }

    for (const [timeKey, commentsAtTime] of groupedComments) {
        const time = parseFloat(timeKey)
        const stamp = createTimestampStamp(time, videoDuration, commentsAtTime)
        bar.appendChild(stamp)
    }
}

function createTimestampStamp(time, videoDuration, commentsAtTime) {
    const stamp = document.createElement('div')
    stamp.classList.add('__youtube-timestamps__stamp')

    if (commentsAtTime.length > 1) {
        stamp.classList.add('__youtube-timestamps__stamp--multiple')
    }

    const offset = time / videoDuration * 100
    stamp.style.left = `calc(${offset}% - 2px)`

    return stamp
}

function getOrCreateBar() {
    let bar = document.querySelector('.__youtube-timestamps__bar')
    if (!bar) {
        const container = document.querySelector('#movie_player .ytp-timed-markers-container') ||
                          document.querySelector('#movie_player .ytp-progress-list')
        bar = document.createElement('div')
        bar.classList.add('__youtube-timestamps__bar')
        container.appendChild(bar)
    }
    return bar
}

function removeBar() {
    const bar = document.querySelector('.__youtube-timestamps__bar')
    bar?.remove()
}



function onLocationHrefChange(callback) {
    let currentHref = document.location.href
    const observer = new MutationObserver(() => {
        if (currentHref !== document.location.href) {
            currentHref = document.location.href
            callback()
        }
    })
    observer.observe(document.querySelector("body"), {childList: true, subtree: true})
}