import { skipPartiallyEmittedExpressions } from "typescript";
import * as Kalidokit from "../dist";
//Import Helper Functions from Kalidokit
const remap = Kalidokit.Utils.remap;
const clamp = Kalidokit.Utils.clamp;
const lerp = Kalidokit.Vector.lerp;

/* THREEJS WORLD SETUP */
let currentVrm1[3];
let currentVrm2;
let currentVrm3;

// renderer
const renderer = new THREE.WebGLRenderer({ alpha: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(window.devicePixelRatio);
document.body.appendChild(renderer.domElement);

// camera
const orbitCamera = new THREE.PerspectiveCamera(35, window.innerWidth / window.innerHeight, 0.1, 1000);
orbitCamera.position.set(0.0, 1.4, 0.7);

// controls
const orbitControls = new THREE.OrbitControls(orbitCamera, renderer.domElement);
orbitControls.screenSpacePanning = true;
orbitControls.target.set(0.0, 1.4, 0.0);
orbitControls.update();

// scene
const scene = new THREE.Scene();

// light
const light = new THREE.DirectionalLight(0xffffff);
light.position.set(1.0, 1.0, 1.0).normalize();
scene.add(light);

// Main Render Loop
const clock = new THREE.Clock();

function animate() {
    requestAnimationFrame(animate);

    // if (vrm) {
    //     // Update model to render physics
    //     vrm.update(clock.getDelta());
    // }
    renderer.render(scene, orbitCamera);
}
animate();


/* VRM CHARACTER SETUP */

// Import Character VRM
// const loader = new THREE.GLTFLoader();
// loader.crossOrigin = "anonymous";
// Import model from URL, add your own model here
// loader.load(
//     "./vrms/AliciaSolid.vrm",

//     (gltf) => {
//         THREE.VRMUtils.removeUnnecessaryJoints(gltf.scene);

//         THREE.VRM.from(gltf).then((vrm) => {
//             scene.add(vrm.scene);
//             currentVrm = vrm;
//             currentVrm.scene.rotation.y = Math.PI; // Rotate model 180deg to face camera
//         });
//     },

//     (progress) => console.log("Loading model...", 100.0 * (progress.loaded / progress.total), "%"),

//     (error) => console.error(error)
// );

// Animate Rotation Helper function
const rigRotation = (vrm, name, rotation = { x: 0, y: 0, z: 0 }, dampener = 1, lerpAmount = 0.3) => {
    if (!vrm) {
        return;
    }
    const Part = vrm.humanoid.getBoneNode(THREE.VRMSchema.HumanoidBoneName[name]);
    if (!Part) {
        return;
    }

    let euler = new THREE.Euler(
        rotation.x * dampener,
        rotation.y * dampener,
        rotation.z * dampener,
        rotation.rotationOrder || "XYZ"
    );
    let quaternion = new THREE.Quaternion().setFromEuler(euler);
    Part.quaternion.slerp(quaternion, lerpAmount); // interpolate
};

// Animate Position Helper Function
const rigPosition = (vrm, name, position = { x: 0, y: 0, z: 0 }, dampener = 1, lerpAmount = 0.3) => {
    if (!vrm) {
        return;
    }
    const Part = vrm.humanoid.getBoneNode(THREE.VRMSchema.HumanoidBoneName[name]);
    if (!Part) {
        return;
    }
    let vector = new THREE.Vector3(position.x * dampener, position.y * dampener, position.z * dampener);
    Part.position.lerp(vector, lerpAmount); // interpolate
};

let oldLookTarget = new THREE.Euler();
const rigFace = (vrm, riggedFace) => {
    if (!vrm) {
        return;
    }
    rigRotation(vrm, "Neck", riggedFace.head, 0.7);

    // Blendshapes and Preset Name Schema
    const Blendshape = vrm.blendShapeProxy;
    const PresetName = THREE.VRMSchema.BlendShapePresetName;

    // Simple example without winking. Interpolate based on old blendshape, then stabilize blink with `Kalidokit` helper function.
    // for VRM, 1 is closed, 0 is open.
    riggedFace.eye.l = lerp(clamp(1 - riggedFace.eye.l, 0, 1), Blendshape.getValue(PresetName.Blink), 0.5);
    riggedFace.eye.r = lerp(clamp(1 - riggedFace.eye.r, 0, 1), Blendshape.getValue(PresetName.Blink), 0.5);
    riggedFace.eye = Kalidokit.Face.stabilizeBlink(riggedFace.eye, riggedFace.head.y);
    Blendshape.setValue(PresetName.Blink, riggedFace.eye.l);

    // Interpolate and set mouth blendshapes
    Blendshape.setValue(PresetName.I, lerp(riggedFace.mouth.shape.I, Blendshape.getValue(PresetName.I), 0.5));
    Blendshape.setValue(PresetName.A, lerp(riggedFace.mouth.shape.A, Blendshape.getValue(PresetName.A), 0.5));
    Blendshape.setValue(PresetName.E, lerp(riggedFace.mouth.shape.E, Blendshape.getValue(PresetName.E), 0.5));
    Blendshape.setValue(PresetName.O, lerp(riggedFace.mouth.shape.O, Blendshape.getValue(PresetName.O), 0.5));
    Blendshape.setValue(PresetName.U, lerp(riggedFace.mouth.shape.U, Blendshape.getValue(PresetName.U), 0.5));

    //PUPILS
    //interpolate pupil and keep a copy of the value
    let lookTarget = new THREE.Euler(
        lerp(oldLookTarget.x, riggedFace.pupil.y, 0.4),
        lerp(oldLookTarget.y, riggedFace.pupil.x, 0.4),
        0,
        "XYZ"
    );
    oldLookTarget.copy(lookTarget);
    vrm.lookAt.applyer.lookAt(lookTarget);
};

/* VRM Character Animator */
const animateVRM = (vrm, results) => {
    if (!vrm) {
        return;
    }
    // Take the results from `Holistic` and animate character based on its Face, Pose, and Hand Keypoints.
    let riggedPose, riggedLeftHand, riggedRightHand, riggedFace;

    const faceLandmarks = results.faceLandmarks;
    // Pose 3D Landmarks are with respect to Hip distance in meters
    const pose3DLandmarks = results.ea;
    // Pose 2D landmarks are with respect to videoWidth and videoHeight
    const pose2DLandmarks = results.poseLandmarks;
    // Be careful, hand landmarks may be reversed
    const leftHandLandmarks = results.rightHandLandmarks;
    const rightHandLandmarks = results.leftHandLandmarks;

    // Animate Face
    if (faceLandmarks) {
        riggedFace = Kalidokit.Face.solve(faceLandmarks, {
            runtime: "mediapipe",
            video: videoElement,
        });
        rigFace(vrm, riggedFace);
    }

    // Animate Pose
    if (pose2DLandmarks && pose3DLandmarks) {
        riggedPose = Kalidokit.Pose.solve(pose3DLandmarks, pose2DLandmarks, {
            runtime: "mediapipe",
            video: videoElement,
        });
        rigRotation(vrm, "Hips", riggedPose.Hips.rotation, 0.7);
        rigPosition(vrm,
            "Hips",
            {
                x: riggedPose.Hips.position.x, // Reverse direction
                y: riggedPose.Hips.position.y + 1, // Add a bit of height
                z: -riggedPose.Hips.position.z, // Reverse direction
            },
            1,
            0.07
        );

        rigRotation(vrm, "Chest", riggedPose.Spine, 0.25, 0.3);
        rigRotation(vrm, "Spine", riggedPose.Spine, 0.45, 0.3);

        rigRotation(vrm, "RightUpperArm", riggedPose.RightUpperArm, 1, 0.3);
        rigRotation(vrm, "RightLowerArm", riggedPose.RightLowerArm, 1, 0.3);
        rigRotation(vrm, "LeftUpperArm", riggedPose.LeftUpperArm, 1, 0.3);
        rigRotation(vrm, "LeftLowerArm", riggedPose.LeftLowerArm, 1, 0.3);

        rigRotation(vrm, "LeftUpperLeg", riggedPose.LeftUpperLeg, 1, 0.3);
        rigRotation(vrm, "LeftLowerLeg", riggedPose.LeftLowerLeg, 1, 0.3);
        rigRotation(vrm, "RightUpperLeg", riggedPose.RightUpperLeg, 1, 0.3);
        rigRotation(vrm, "RightLowerLeg", riggedPose.RightLowerLeg, 1, 0.3);
    }

    // Animate Hands
    if (leftHandLandmarks) {
        riggedLeftHand = Kalidokit.Hand.solve(leftHandLandmarks, "Left");
        rigRotation(vrm, "LeftHand", {
            // Combine pose rotation Z and hand rotation X Y
            z: riggedPose.LeftHand.z,
            y: riggedLeftHand.LeftWrist.y,
            x: riggedLeftHand.LeftWrist.x,
        });
        rigRotation(vrm, "LeftRingProximal", riggedLeftHand.LeftRingProximal);
        rigRotation(vrm, "LeftRingIntermediate", riggedLeftHand.LeftRingIntermediate);
        rigRotation(vrm, "LeftRingDistal", riggedLeftHand.LeftRingDistal);
        rigRotation(vrm, "LeftIndexProximal", riggedLeftHand.LeftIndexProximal);
        rigRotation(vrm, "LeftIndexIntermediate", riggedLeftHand.LeftIndexIntermediate);
        rigRotation(vrm, "LeftIndexDistal", riggedLeftHand.LeftIndexDistal);
        rigRotation(vrm, "LeftMiddleProximal", riggedLeftHand.LeftMiddleProximal);
        rigRotation(vrm, "LeftMiddleIntermediate", riggedLeftHand.LeftMiddleIntermediate);
        rigRotation(vrm, "LeftMiddleDistal", riggedLeftHand.LeftMiddleDistal);
        rigRotation(vrm, "LeftThumbProximal", riggedLeftHand.LeftThumbProximal);
        rigRotation(vrm, "LeftThumbIntermediate", riggedLeftHand.LeftThumbIntermediate);
        rigRotation(vrm, "LeftThumbDistal", riggedLeftHand.LeftThumbDistal);
        rigRotation(vrm, "LeftLittleProximal", riggedLeftHand.LeftLittleProximal);
        rigRotation(vrm, "LeftLittleIntermediate", riggedLeftHand.LeftLittleIntermediate);
        rigRotation(vrm, "LeftLittleDistal", riggedLeftHand.LeftLittleDistal);
    }
    if (rightHandLandmarks) {
        riggedRightHand = Kalidokit.Hand.solve(rightHandLandmarks, "Right");
        rigRotation(vrm, "RightHand", {
            // Combine Z axis from pose hand and X/Y axis from hand wrist rotation
            z: riggedPose.RightHand.z,
            y: riggedRightHand.RightWrist.y,
            x: riggedRightHand.RightWrist.x,
        });
        rigRotation(vrm, "RightRingProximal", riggedRightHand.RightRingProximal);
        rigRotation(vrm, "RightRingIntermediate", riggedRightHand.RightRingIntermediate);
        rigRotation(vrm, "RightRingDistal", riggedRightHand.RightRingDistal);
        rigRotation(vrm, "RightIndexProximal", riggedRightHand.RightIndexProximal);
        rigRotation(vrm, "RightIndexIntermediate", riggedRightHand.RightIndexIntermediate);
        rigRotation(vrm, "RightIndexDistal", riggedRightHand.RightIndexDistal);
        rigRotation(vrm, "RightMiddleProximal", riggedRightHand.RightMiddleProximal);
        rigRotation(vrm, "RightMiddleIntermediate", riggedRightHand.RightMiddleIntermediate);
        rigRotation(vrm, "RightMiddleDistal", riggedRightHand.RightMiddleDistal);
        rigRotation(vrm, "RightThumbProximal", riggedRightHand.RightThumbProximal);
        rigRotation(vrm, "RightThumbIntermediate", riggedRightHand.RightThumbIntermediate);
        rigRotation(vrm, "RightThumbDistal", riggedRightHand.RightThumbDistal);
        rigRotation(vrm, "RightLittleProximal", riggedRightHand.RightLittleProximal);
        rigRotation(vrm, "RightLittleIntermediate", riggedRightHand.RightLittleIntermediate);
        rigRotation(vrm, "RightLittleDistal", riggedRightHand.RightLittleDistal);
    }
};

/* SETUP MEDIAPIPE HOLISTIC INSTANCE */
let videoElement = document.querySelector(".input_video"),
    guideCanvas = document.querySelector("canvas.guides");

const onResults = (results) => {
    // Draw landmark guides
    drawResults(results);
    // Animate model
    animateVRM(currentVrm1, results);
    animateVRM(currentVrm2, results);
    animateVRM(currentVrm3, results);
};

const holistic = new Holistic({
    locateFile: (file) => {
        return `./holistic/${file}`;
    },
});

holistic.setOptions({
    modelComplexity: 1,
    smoothLandmarks: true,
    minDetectionConfidence: 0.7,
    minTrackingConfidence: 0.7,
    refineFaceLandmarks: true,
});
// Pass holistic a callback function
holistic.onResults(onResults);

const drawResults = (results) => {
    guideCanvas.width = videoElement.videoWidth;
    guideCanvas.height = videoElement.videoHeight;
    let canvasCtx = guideCanvas.getContext("2d");
    canvasCtx.save();
    canvasCtx.clearRect(0, 0, guideCanvas.width, guideCanvas.height);
    // Use `Mediapipe` drawing functions
    drawConnectors(canvasCtx, results.poseLandmarks, POSE_CONNECTIONS, {
        color: "#00cff7",
        lineWidth: 4,
    });
    drawLandmarks(canvasCtx, results.poseLandmarks, {
        color: "#ff0364",
        lineWidth: 2,
    });
    drawConnectors(canvasCtx, results.faceLandmarks, FACEMESH_TESSELATION, {
        color: "#C0C0C070",
        lineWidth: 1,
    });
    if (results.faceLandmarks && results.faceLandmarks.length === 478) {
        //draw pupils
        drawLandmarks(canvasCtx, [results.faceLandmarks[468], results.faceLandmarks[468 + 5]], {
            color: "#ffe603",
            lineWidth: 2,
        });
    }
    drawConnectors(canvasCtx, results.leftHandLandmarks, HAND_CONNECTIONS, {
        color: "#eb1064",
        lineWidth: 5,
    });
    drawLandmarks(canvasCtx, results.leftHandLandmarks, {
        color: "#00cff7",
        lineWidth: 2,
    });
    drawConnectors(canvasCtx, results.rightHandLandmarks, HAND_CONNECTIONS, {
        color: "#22c3e3",
        lineWidth: 5,
    });
    drawLandmarks(canvasCtx, results.rightHandLandmarks, {
        color: "#ff0364",
        lineWidth: 2,
    });
};

// Use `Mediapipe` utils to get camera - lower resolution = higher fps
const camera = new Camera(videoElement, {
    onFrame: async () => {
        await holistic.send({ image: videoElement });
    },
    width: 640,
    height: 480,
});
camera.start();

const loader = new THREE.GLTFLoader();
function loadVrm1(url){
 
    loader.load(
        url,
        (gltf) => {
            THREE.VRMUtils.removeUnnecessaryJoints(gltf.scene);

            THREE.VRM.from(gltf).then((vrm) => {
                scene.add(vrm.scene);
                currentVrm1 = vrm;
                currentVrm1.scene.rotation.y = Math.PI; // Rotate model 180deg to face camera
            });
        },

        (progress) => console.log("Loading model...", 100.0 * (progress.loaded / progress.total), "%"),

        (error) => console.error(error)
    );
}

function loadVrm2(url){
 
    loader.load(
        url,
        (gltf) => {
            THREE.VRMUtils.removeUnnecessaryJoints(gltf.scene);

            THREE.VRM.from(gltf).then((vrm) => {
                scene.add(vrm.scene);
                currentVrm1 = vrm;
                currentVrm1.scene.rotation.y = Math.PI; // Rotate model 180deg to face camera
            });
        },

        (progress) => console.log("Loading model...", 100.0 * (progress.loaded / progress.total), "%"),

        (error) => console.error(error)
    );
}


loadVrm1("./vrms/AliciaSolid.vrm");

setTimeout(() => {
    currentVrm1.scene.position.x = -0.4;
    currentVrm1.scene.position.y = 0.1;
    loadVrm2("./vrms/Midori.vrm") ;
}, 10000);


// setTimeout(() => {
//     // currentVrm2.scene.position.x = 0.4;
//     // currentVrm2.scene.position.y = 0.1;
//     loadVrm(currentVrm3, "./vrms/Ashtra.vrm") ;

// }, 10000);