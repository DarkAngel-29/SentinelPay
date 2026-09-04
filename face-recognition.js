/* =================================================================
   AI FRAUDSHIELD â€” face-recognition.js
   Face Verification Engine  |  face-api.js v0.22.2
   -----------------------------------------------------------------
   PURPOSE
   -------
   In-browser face verification for step-up authentication on
   MEDIUM / HIGH-risk transactions.  All processing is local â€”
   no image or descriptor is ever transmitted externally.

   ARCHITECTURE
   ------------
   Three neural networks loaded from ./models/:
     TinyFaceDetector       â€” fast bounding-box detection
     FaceLandmark68TinyNet  â€” 68 facial landmark points
     FaceRecognitionNet     â€” 128-dim descriptor vector

   Reference face (./assets/reference-face.jpg) is loaded once per
   browser session.  Its 128-float descriptor lives ONLY in JS memory
   (_referenceDescriptor).  It is never written to localStorage,
   cookies, or any storage API.

   MATCH LOGIC
   -----------
   Every 350 ms the live camera frame is analysed:
     0 faces    â†’ keep scanning
     2+ faces   â†’ warn, refuse to match, keep scanning
     1 face     â†’ euclideanDistance(live, reference)
                  < FACE_MATCH_THRESHOLD â†’ call onSuccess()
                  â‰¥ threshold            â†’ keep scanning

   SAFETY GUARANTEES
   -----------------
   * Camera / model / reference errors NEVER call onSuccess().
   * The existing 20-s countdown in app.js runs independently.
   * If no match within 20 s the existing timeout fires voice-call.
   * FaceVerify.stop() is wired to every exit path by app.js:
     cancel button, countdown timeout, backdrop/Esc close.

   INTEGRATION (app.js)
   --------------------
   Called from : showVerification(tx, riskResult)
   Cleanup from: cancel handler, countdown timeout, closeOverlay()
   ================================================================= */

'use strict';

/* -----------------------------------------------------------------
   CONFIGURATION
   -----------------------------------------------------------------
   Adjust FACE_MATCH_THRESHOLD after testing with the actual webcam
   and reference image.  This is the ONLY constant that controls
   match strictness.  Lower = stricter.
     0.40 â€” very strict  (may fail on lighting changes)
     0.50 â€” recommended  (good balance for webcam demos)
     0.60 â€” lenient      (higher false-accept rate)
   ----------------------------------------------------------------- */
const FACE_MATCH_THRESHOLD       = 0.50;
const FACE_MODELS_PATH           = './models';
const FACE_REFERENCE_IMAGE_PATH  = './assets/reference-face.jpg';
const FACE_MIN_SCORE             = 0.5;
const FACE_DETECTION_INTERVAL_MS = 350;


/* -----------------------------------------------------------------
   MODULE STATE  (all private)
   ----------------------------------------------------------------- */
let _modelsLoaded        = false;
let _modelLoading        = false;
let _referenceDescriptor = null;   // Float32Array(128) â€” session memory only
let _cameraStream        = null;   // MediaStream | null
let _detectionLoop       = null;   // setInterval handle
let _isRunning           = false;
let _onSuccessCb         = null;


/* =================================================================
   1.  MODEL LOADING
   ================================================================= */

async function loadModels() {
  if (_modelsLoaded) return;
  if (_modelLoading) {
    // Another async call is already loading â€” poll until done.
    await new Promise(resolve => {
      const poll = setInterval(() => {
        if (_modelsLoaded) { clearInterval(poll); resolve(); }
      }, 100);
    });
    return;
  }
  _modelLoading = true;
  try {
    await Promise.all([
      faceapi.nets.tinyFaceDetector.loadFromUri(FACE_MODELS_PATH),
      faceapi.nets.faceLandmark68TinyNet.loadFromUri(FACE_MODELS_PATH),
      faceapi.nets.faceRecognitionNet.loadFromUri(FACE_MODELS_PATH),
    ]);
    _modelsLoaded = true;
    console.log('[FaceVerify] Models loaded from', FACE_MODELS_PATH);
  } finally {
    _modelLoading = false;
  }
}


/* =================================================================
   2.  REFERENCE DESCRIPTOR  (session memory â€” never persisted)
   ================================================================= */

/**
 * Loads the reference image, detects the registered face, and stores
 * its 128-float descriptor in _referenceDescriptor.
 * Returns true on success, false on any failure.
 *
 * Uses a larger inputSize (608) and lower threshold than the live loop
 * because this runs only ONCE on a still image (no speed constraint).
 * Retries with progressively lower thresholds to handle backlit / dark
 * reference photos.
 */
async function loadReferenceDescriptor() {
  if (_referenceDescriptor) return true;  // already loaded this session

  return new Promise(resolve => {
    const img = new Image();
    img.crossOrigin = 'anonymous';

    img.onload = async () => {
      // Try multiple thresholds — start strict, relax progressively.
      // Still images only run once so we can afford larger inputSize.
      const thresholds = [0.2, 0.15, 0.10, 0.05];
      const inputSizes = [608, 416, 320];

      for (const inputSize of inputSizes) {
        for (const scoreThreshold of thresholds) {
          try {
            const opts = new faceapi.TinyFaceDetectorOptions({ inputSize, scoreThreshold });
            const result = await faceapi
              .detectSingleFace(img, opts)
              .withFaceLandmarks(true)
              .withFaceDescriptor();

            if (result) {
              _referenceDescriptor = result.descriptor;
              console.log(
                `[FaceVerify] Reference descriptor ready (inputSize=${inputSize}, threshold=${scoreThreshold}).`
              );
              resolve(true);
              return;
            }
          } catch (err) {
            console.warn('[FaceVerify] Detection attempt error:', inputSize, scoreThreshold, err.message);
          }
        }
      }

      console.error('[FaceVerify] No face detected in reference image after all attempts.');
      resolve(false);
    };

    img.onerror = () => {
      console.error('[FaceVerify] Failed to load:', FACE_REFERENCE_IMAGE_PATH);
      resolve(false);
    };

    // Cache-bust to ensure fresh load when image has been swapped.
    img.src = FACE_REFERENCE_IMAGE_PATH + '?t=' + Date.now();
  });
}



/* =================================================================
   3.  CAMERA MANAGEMENT
   ================================================================= */

async function startCamera(videoEl) {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } },
      audio: false,
    });
    videoEl.srcObject = stream;
    _cameraStream = stream;
    await new Promise(resolve => { videoEl.onloadedmetadata = resolve; });
    await videoEl.play();
    return { ok: true };
  } catch (err) {
    const denied = ['NotAllowedError', 'PermissionDeniedError'].includes(err.name);
    console.warn('[FaceVerify] Camera error:', err.name);
    return { ok: false, denied };
  }
}

function stopCamera() {
  if (_cameraStream) {
    _cameraStream.getTracks().forEach(t => t.stop());
    _cameraStream = null;
  }
}

function stopDetectionLoop() {
  if (_detectionLoop) { clearInterval(_detectionLoop); _detectionLoop = null; }
}


/* =================================================================
   4.  FACE LANDMARK OVERLAY  (visual feedback â€” non-critical)
   ================================================================= */

function drawLandmarks(videoEl, detections) {
  const canvas = document.getElementById('fv-overlay');
  if (!canvas || !videoEl || !detections || !detections.length) return;
  try {
    const dims    = faceapi.matchDimensions(canvas, videoEl, true);
    const resized = faceapi.resizeResults(detections, dims);
    faceapi.draw.drawFaceLandmarks(canvas, resized);
  } catch { /* non-critical */ }
}

function clearLandmarks() {
  const canvas = document.getElementById('fv-overlay');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  if (ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
}


/* =================================================================
   5.  UI HELPERS  (target existing DOM from app.js)
   ================================================================= */

/** Updates #verify-status-text â€” rendered by showVerification() */
function setStatus(text, color) {
  const el = document.getElementById('verify-status-text');
  if (!el) return;
  el.textContent = text;
  el.style.color = color || '';
}

/** Updates #fv-hint â€” hint paragraph below the camera frame */
function setHint(text, color) {
  const el = document.getElementById('fv-hint');
  if (!el) return;
  el.textContent = text;
  el.style.color = color || '';
}

/**
 * Replaces the content of the existing #face-verify-area with a
 * live camera view.  The outer #face-verify-area div stays in place
 * so the surrounding layout (status row, countdown, cancel button)
 * is completely untouched.
 */
function injectCameraUI(videoId) {
  const area = document.getElementById('face-verify-area');
  if (!area) return;
  area.innerHTML = `
    <div class="face-verify-frame" style="position:relative;">
      <div class="face-verify-reticle" style="overflow:hidden;background:#080808;">
        <span class="reticle-corner tl"></span>
        <span class="reticle-corner tr"></span>
        <span class="reticle-corner bl"></span>
        <span class="reticle-corner br"></span>
        <video id="${videoId}" playsinline muted
          style="width:100%;height:100%;object-fit:cover;transform:scaleX(-1);display:block;"></video>
        <canvas id="fv-overlay"
          style="position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none;transform:scaleX(-1);"></canvas>
      </div>
      <p class="face-verify-hint mono" id="fv-hint"
        style="color:var(--clr-text-dim);">INITIALISING CAMERA...</p>
    </div>`;
}

/**
 * Replaces the content of #face-verify-area with a static message
 * (loading / error states where no camera is shown).
 */
function injectMessageUI(innerLabel, hintText, color) {
  const area = document.getElementById('face-verify-area');
  if (!area) return;
  const c = color || 'var(--clr-text-dim)';
  area.innerHTML = `
    <div class="face-verify-frame">
      <div class="face-verify-reticle"
        style="background:#080808;display:flex;align-items:center;justify-content:center;">
        <span class="reticle-corner tl"></span>
        <span class="reticle-corner tr"></span>
        <span class="reticle-corner bl"></span>
        <span class="reticle-corner br"></span>
        <p class="face-verify-inner-label mono"
          style="color:${c};text-align:center;padding:0 16px;">${innerLabel}</p>
      </div>
    </div>
    <p class="face-verify-hint mono" id="fv-hint" style="color:${c};">${hintText}</p>`;
}


/* =================================================================
   6.  FULL CLEANUP  (public â€” called by app.js on all exit paths)
   ================================================================= */

function stopFaceVerification() {
  _isRunning   = false;
  _onSuccessCb = null;
  stopDetectionLoop();
  stopCamera();
}


/* =================================================================
   7.  LIVE VERIFICATION LOOP
   ================================================================= */

async function runLiveVerification() {
  const VIDEO_ID = 'fv-video';
  injectCameraUI(VIDEO_ID);
  setStatus('SCANNING...', '');

  const videoEl = document.getElementById(VIDEO_ID);
  if (!videoEl) { _isRunning = false; return; }

  const cam = await startCamera(videoEl);
  if (!cam.ok) {
    const msg  = cam.denied ? 'CAMERA PERMISSION DENIED' : 'CAMERA UNAVAILABLE';
    const hint = cam.denied
      ? 'Camera access was denied. Timer will handle timeout via voice call.'
      : 'Camera is unavailable. Timer will handle timeout via voice call.';
    injectMessageUI('CAMERA<br>UNAVAILABLE', hint, 'var(--clr-danger)');
    setStatus(msg, 'var(--clr-danger)');
    // DO NOT call onSuccess â€” let the 20-s timer fire voice-call fallback.
    _isRunning = false;
    return;
  }

  setHint('SCANNING FOR FACE...', 'var(--clr-text-dim)');
  let matchDone = false;

  _detectionLoop = setInterval(async () => {
    if (!_isRunning || matchDone) return;

    let detections;
    try {
      detections = await faceapi
        .detectAllFaces(videoEl, new faceapi.TinyFaceDetectorOptions({
          inputSize:      320,
          scoreThreshold: FACE_MIN_SCORE,
        }))
        .withFaceLandmarks(true)
        .withFaceDescriptors();
    } catch {
      setHint('DETECTION ERROR â€” RETRYING...', 'var(--clr-text-dim)');
      return;
    }

    if (!detections) return;

    /* â”€â”€ 0 faces â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
    if (detections.length === 0) {
      clearLandmarks();
      setHint('NO FACE DETECTED â€” LOOK AT CAMERA', 'var(--clr-text-dim)');
      setStatus('SCANNING...', '');
      return;
    }

    /* â”€â”€ 2+ faces â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
    if (detections.length > 1) {
      clearLandmarks();
      setHint('MULTIPLE FACES â€” ACCOUNT HOLDER ONLY PLEASE', 'var(--clr-accent)');
      setStatus('MULTIPLE FACES', 'var(--clr-accent)');
      return;
    }

    /* â”€â”€ 1 face â€” compare against reference â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
    drawLandmarks(videoEl, detections);
    const distance = faceapi.euclideanDistance(
      _referenceDescriptor,
      detections[0].descriptor
    );
    const isMatch = distance < FACE_MATCH_THRESHOLD;

    if (isMatch) {
      /* Confirmed match â€” stop everything, signal success */
      matchDone = true;
      stopDetectionLoop();
      setHint('IDENTITY VERIFIED', 'var(--clr-ok)');
      setStatus('VERIFIED \u2713', 'var(--clr-ok)');
      /* Brief pause so user sees the confirmed state before transition */
      setTimeout(() => {
        stopCamera();
        if (_isRunning && _onSuccessCb) {
          _isRunning = false;
          _onSuccessCb();
        }
      }, 700);

    } else {
      /* Face present but not matching â€” keep scanning */
      const near = distance < FACE_MATCH_THRESHOLD + 0.12;
      setHint(
        near
          ? `VERIFYING FACE... (${distance.toFixed(3)})`
          : `FACE VERIFICATION FAILED (${distance.toFixed(3)})`,
        near ? 'var(--clr-accent)' : 'var(--clr-danger)'
      );
      setStatus('ANALYSING...', 'var(--clr-accent)');
    }
  }, FACE_DETECTION_INTERVAL_MS);
}


/* =================================================================
   8.  PUBLIC ENTRY POINT
   ================================================================= */

/**
 * startFaceVerification({ tx, riskResult, onSuccess })
 *
 * Called by app.js showVerification() AFTER the modal HTML is in DOM.
 * At call time these elements already exist:
 *   #face-verify-area   â€” camera placeholder (replaced by this module)
 *   #verify-status-text â€” status text (updated live)
 *   #countdown-num      â€” countdown display (owned entirely by app.js)
 *   #btn-cancel-verify  â€” cancel button (app.js adds FaceVerify.stop())
 *
 * onSuccess callback must:
 *   1. Call FaceVerify.stop()
 *   2. Call clearCountdown()
 *   3. Call showFaceVerified(tx, riskResult)
 */
async function startFaceVerification({ tx, riskResult, onSuccess }) {
  if (_isRunning) {
    console.warn('[FaceVerify] Already running â€” ignoring duplicate call.');
    return;
  }
  _isRunning   = true;
  _onSuccessCb = onSuccess;

  /* Step 1 â€” Loading state (shown while models download from ./models/) */
  injectMessageUI(
    'LOADING FACE<br>VERIFICATION...',
    'Initialising neural networks â€” please wait.',
    'var(--clr-text-dim)'
  );
  setStatus('LOADING MODELS...', 'var(--clr-text-dim)');

  /* Step 2 â€” Load the three neural networks */
  try {
    await loadModels();
  } catch (err) {
    console.error('[FaceVerify] Model load failed:', err);
    injectMessageUI(
      'FACE VERIFICATION<br>UNAVAILABLE',
      'Neural networks failed to load. Timer will handle timeout.',
      'var(--clr-danger)'
    );
    setStatus('MODEL LOAD FAILED', 'var(--clr-danger)');
    _isRunning = false;
    return;  // Let 20-s timer expire â†’ voice-call fallback
  }

  /* Step 3 â€” Generate reference descriptor (session memory only) */
  setStatus('LOADING REFERENCE FACE...', 'var(--clr-text-dim)');
  const refOk = await loadReferenceDescriptor();
  if (!refOk) {
    injectMessageUI(
      'REFERENCE FACE<br>UNAVAILABLE',
      'Reference face could not be loaded. Timer will handle timeout.',
      'var(--clr-danger)'
    );
    setStatus('REFERENCE UNAVAILABLE', 'var(--clr-danger)');
    _isRunning = false;
    return;  // Let 20-s timer expire â†’ voice-call fallback
  }

  /* Step 4 â€” Start live verification loop */
  await runLiveVerification();
}


/* =================================================================
   9.  GLOBAL EXPORTS
   ================================================================= */

window.FaceVerify = {
  /**
   * start({ tx, riskResult, onSuccess })
   * Main entry point â€” called by app.js showVerification()
   * after the verification modal DOM is ready.
   */
  start: startFaceVerification,

  /**
   * stop()
   * MUST be called by app.js on all exit paths:
   *   - cancel button clicked
   *   - 20-s countdown timeout (before showCallFallback)
   *   - backdrop / Escape key close
   *   - face-match success (before showing success screen)
   * Stops camera stream and detection interval, resets state.
   */
  stop: stopFaceVerification,

  /**
   * resetReference()
   * Clears the in-memory descriptor so it is re-generated on the
   * next verification call.  Useful during testing when the
   * reference image is swapped.
   */
  resetReference() {
    _referenceDescriptor = null;
    console.log('[FaceVerify] In-memory reference descriptor cleared.');
  },

  /** Expose threshold for console tuning during testing. */
  get threshold() { return FACE_MATCH_THRESHOLD; },
};

console.log('[FaceVerify] Module ready. Match threshold:', FACE_MATCH_THRESHOLD);

