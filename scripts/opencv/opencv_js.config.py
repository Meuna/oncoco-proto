# Whitelist for a minimal OpenCV.js build: only the bindings the app uses.
# Read by opencv/platforms/js/build_js.py (--config); `makeWhiteList` comes from its embindgen.
# Add a function here when a new OpenCV-based algorithm needs it, then rebuild.

core = {
    '': ['mean', 'minMaxLoc'],
}

imgproc = {
    '': [
        'Canny',
        'GaussianBlur',
        'HoughCircles',
        'arcLength',
        'contourArea',
        'dilate',
        'findContours',
        'fitEllipse',
        'getStructuringElement',
        'cvtColor',
        'medianBlur',
    ],
}

white_list = makeWhiteList([core, imgproc])
