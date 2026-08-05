// @ts-nocheck
import { Color, DoubleSide, LinearSRGBColorSpace, MeshPhysicalMaterial, MeshStandardMaterial, RGBAFormat, RepeatWrapping, SRGBColorSpace, Vector2 } from 'three';
import * as Shared from './shared.js';
import { disposeTexturesFromMaterial } from '../../../../../shared/utils/three/dispose.ts';
import { getDefaultMaterial, setDefaultMaterial } from './default-material-state.js';
import { applyUnifiedHydraMaterialDefaults, createHydraColorFromTuple, createUnifiedHydraPhysicalMaterial, createUnifiedHydraStandardMaterial, hydraMaterialRequiresPhysicalExtensions } from './material-defaults.js';
const { buildProtoPrimPathCandidates, clamp01, createMatrixFromXformOp, debugInstancer, debugMaterials, debugMeshes, debugPrims, debugTextures, defaultGrayComponent, disableMaterials, disableTextures, extractPrimPathFromMaterialBindingWarning, extractReferencePrimTargets, extractScopeBodyText, extractUsdAssetReferencesFromLayerText, getActiveMaterialBindingWarningOwner, getAngleInRadians, getCollisionGeometryTypeFromUrdfElement, getExpectedPrimTypesForCollisionProto, getExpectedPrimTypesForProtoType, getMatrixMaxElementDelta, getPathBasename, getPathWithoutRoot, getRawConsoleMethod, getRootPathFromPrimPath, getSafePrimTypeName, hasNonZeroTranslation, hydraCallbackErrorCounts, installMaterialBindingApiWarningInterceptor, isIdentityQuaternion, isLikelyDefaultGrayMaterial, isLikelyInverseTransform, isMaterialBindingApiWarningMessage, isMatrixApproximatelyIdentity, isNonZero, isPotentiallyLargeBaseAssetPath, logHydraCallbackError, materialBindingRepairMaxLayerTextLength, materialBindingWarningHandlers, maxHydraCallbackErrorLogsPerMethod, nearlyEqual, normalizeHydraPath, normalizeUsdPathToken, parseGuideCollisionReferencesFromLayerText, parseProtoMeshIdentifier, parseUrdfTruthFromText, parseVector3Text, parseXformOpFallbacksFromLayerText, rawConsoleError, rawConsoleWarn, registerMaterialBindingApiWarningHandler, remapRootPathIfNeeded, resolveUrdfTruthFileNameForStagePath, resolveUsdAssetPath, setActiveMaterialBindingWarningOwner, shouldAllowLargeBaseAssetScan, stringifyConsoleArgs, toArrayLike, toColorArray, toFiniteNumber, toFiniteQuaternionWxyzTuple, toFiniteVector2Tuple, toFiniteVector3Tuple, toMatrixFromUrdfOrigin, toQuaternionWxyzFromRpy, transformEpsilon, wrapHydraCallbackObject } = Shared;
let warningMessagesToCount = new Map();
let warnedMissingMaterials = new Set();
class HydraMaterial {
    static _isMeshPhysicalMaterial(material) {
        return Boolean(material && material.isMeshPhysicalMaterial === true);
    }
    static _isMeshStandardOnlyMaterial(material) {
        return Boolean(material
            && material.isMeshStandardMaterial === true
            && material.isMeshPhysicalMaterial !== true);
    }
    static _readBooleanParameter(materialNode, parameterNames) {
        if (!materialNode || !Array.isArray(parameterNames))
            return undefined;
        for (const parameterName of parameterNames) {
            if (!(parameterName in materialNode))
                continue;
            const value = materialNode[parameterName];
            if (value === undefined || value === null)
                continue;
            if (typeof value === 'boolean')
                return value;
            const numeric = toFiniteNumber(value);
            if (numeric !== undefined)
                return numeric !== 0;
            const normalized = String(value || '').trim().toLowerCase();
            if (!normalized)
                continue;
            if (normalized === 'true' || normalized === 'yes' || normalized === 'on')
                return true;
            if (normalized === 'false' || normalized === 'no' || normalized === 'off')
                return false;
        }
        return undefined;
    }
    static _isEmissionEnabled(materialNode) {
        return HydraMaterial._readBooleanParameter(materialNode, [
            'enable_emission',
            'enableEmission',
        ]) !== false;
    }
    static _isOpacityEnabled(materialNode) {
        return HydraMaterial._readBooleanParameter(materialNode, [
            'enable_opacity',
            'enableOpacity',
        ]) !== false;
    }
    static _isOpacityTextureEnabled(materialNode) {
        return HydraMaterial._readBooleanParameter(materialNode, [
            'enable_opacity_texture',
            'enableOpacityTexture',
        ]) !== false;
    }
    static _nodeRequiresPhysicalMaterial(materialNode) {
        if (!materialNode || typeof materialNode !== 'object')
            return false;
        const candidateNames = [];
        for (const [parameterName, materialProperty] of Object.entries(HydraMaterial.usdPreviewToMeshPhysicalMap)) {
            if (materialNode[parameterName] === undefined || materialNode[parameterName] === null)
                continue;
            candidateNames.push(materialProperty);
        }
        for (const [parameterName, textureProperty] of Object.entries(HydraMaterial.usdPreviewToMeshPhysicalTextureMap)) {
            if (!materialNode[parameterName]?.nodeIn)
                continue;
            candidateNames.push(textureProperty);
        }
        return hydraMaterialRequiresPhysicalExtensions(candidateNames);
    }
    constructor(id, hydraInterface) {
        this._id = id;
        this._nodes = {};
        this._interface = hydraInterface;
        this._ownedMaterial = null;
        if (!getDefaultMaterial()) {
            setDefaultMaterial(createUnifiedHydraStandardMaterial({
                side: DoubleSide,
                color: new Color(0xff2997), // a bright pink color to indicate a missing material
                name: 'DefaultMaterial',
            }));
        }
        // proper color when materials are disabled
        if (disableMaterials && getDefaultMaterial()) {
            getDefaultMaterial().color = new Color(0x999999);
            applyUnifiedHydraMaterialDefaults(getDefaultMaterial());
        }
        /** @type {MeshStandardMaterial | MeshPhysicalMaterial} */
        this._material = getDefaultMaterial();
    }
    prepareOwnedMaterial(name, usePhysicalMaterial = false) {
        const createTemplateMaterial = () => usePhysicalMaterial
            ? createUnifiedHydraPhysicalMaterial({ name })
            : createUnifiedHydraStandardMaterial({ name });
        const canReuseOwnedMaterial = usePhysicalMaterial
            ? HydraMaterial._isMeshPhysicalMaterial(this._ownedMaterial)
            : HydraMaterial._isMeshStandardOnlyMaterial(this._ownedMaterial);
        if (canReuseOwnedMaterial) {
            disposeTexturesFromMaterial(this._ownedMaterial);
            const resetTemplate = createTemplateMaterial();
            this._ownedMaterial.copy(resetTemplate);
            this._ownedMaterial.name = name;
            this._ownedMaterial.needsUpdate = true;
            resetTemplate.dispose();
        }
        else {
            if (this._ownedMaterial) {
                disposeTexturesFromMaterial(this._ownedMaterial);
                this._ownedMaterial.dispose?.();
            }
            this._ownedMaterial = createTemplateMaterial();
        }
        this._material = this._ownedMaterial;
        return this._material;
    }
    static getNodePreviewSurfaceScore(node) {
        if (!node || typeof node !== 'object')
            return -1;
        const candidateKeys = new Set([
            'diffuseColor',
            'baseColor',
            'base_color',
            'base_color_constant',
            'albedo',
            'albedo_constant',
            'diffuse_color',
            'diffuse_color_constant',
            'roughness',
            'metallic',
            'metalness',
            'opacity',
            'specular',
            'specularColor',
            'emissiveColor',
            'emissive_color',
            'emissive_color_constant',
            'clearcoat',
            'transmission',
            ...Object.keys(HydraMaterial.usdPreviewToMeshPhysicalMap || {}),
            ...Object.keys(HydraMaterial.usdPreviewToMeshPhysicalTextureMap || {}),
        ]);
        let score = 0;
        for (const key of candidateKeys) {
            if (node[key] !== undefined)
                score += 1;
        }
        if (node.diffuseColor !== undefined
            || node.baseColor !== undefined
            || node.base_color !== undefined
            || node.base_color_constant !== undefined
            || node.albedo !== undefined
            || node.albedo_constant !== undefined
            || node.diffuse_color !== undefined
            || node.diffuse_color_constant !== undefined) {
            score += 3;
        }
        if (node.outputs?.surface || node.outputs?.out || node.outputs?.mdl?.surface) {
            score += 1;
        }
        return score;
    }
    static resolveMainMaterialNode(nodes) {
        if (!nodes || typeof nodes !== 'object')
            return null;
        let bestNode = null;
        let bestScore = -1;
        for (const node of Object.values(nodes)) {
            const score = HydraMaterial.getNodePreviewSurfaceScore(node);
            if (score <= bestScore)
                continue;
            bestScore = score;
            bestNode = node;
        }
        if (bestScore <= 0)
            return null;
        return bestNode;
    }
    updateNode(networkId, path, parameters) {
        this._nodes[path] = parameters;
    }
    async applyNetworkUpdate(networkUpdates) {
        const safeNetworkUpdates = Array.isArray(networkUpdates) ? networkUpdates : [];
        this._nodes = {};
        for (const networkUpdate of safeNetworkUpdates) {
            if (!networkUpdate)
                continue;
            const networkId = String(networkUpdate.networkId || "");
            const safeNodes = Array.isArray(networkUpdate.nodes) ? networkUpdate.nodes : [];
            for (const nodeUpdate of safeNodes) {
                if (!nodeUpdate)
                    continue;
                const path = normalizeHydraPath(nodeUpdate.path || "");
                if (!path)
                    continue;
                const parameters = nodeUpdate.parameters && typeof nodeUpdate.parameters === "object"
                    ? nodeUpdate.parameters
                    : {};
                this.updateNode(networkId, path, parameters);
            }
        }
        for (const networkUpdate of safeNetworkUpdates) {
            if (!networkUpdate)
                continue;
            const networkId = String(networkUpdate.networkId || "");
            const relationships = Array.isArray(networkUpdate.relationships) ? networkUpdate.relationships : [];
            await this.updateFinished(networkId, relationships);
        }
    }
    convertWrap(usdWrapMode) {
        if (usdWrapMode === undefined)
            return RepeatWrapping;
        const WRAPPINGS = {
            'repeat': 1000, // RepeatWrapping
            'clamp': 1001, // ClampToEdgeWrapping
            'mirror': 1002 // MirroredRepeatWrapping
        };
        if (WRAPPINGS[usdWrapMode])
            return WRAPPINGS[usdWrapMode];
        return RepeatWrapping;
    }
    /**
     * @return {Promise<void>}
     */
    assignTexture(mainMaterial, parameterName) {
        return new Promise((resolve, reject) => {
            const materialParameterMapName = HydraMaterial.usdPreviewToMeshPhysicalTextureMap[parameterName];
            if (materialParameterMapName === undefined) {
                console.error(`Unsupported material texture parameter '${parameterName}'.`);
                resolve();
                return;
            }
            const emissionEnabled = HydraMaterial._isEmissionEnabled(mainMaterial);
            const opacityEnabled = HydraMaterial._isOpacityEnabled(mainMaterial);
            const opacityTextureEnabled = HydraMaterial._isOpacityTextureEnabled(mainMaterial);
            if (materialParameterMapName === 'emissiveMap' && !emissionEnabled) {
                resolve();
                return;
            }
            if (materialParameterMapName === 'alphaMap' && (!opacityEnabled || !opacityTextureEnabled)) {
                resolve();
                return;
            }
            if (mainMaterial[parameterName] && mainMaterial[parameterName].nodeIn) {
                const nodeIn = mainMaterial[parameterName].nodeIn;
                if (!nodeIn.resolvedPath) {
                    console.error("Texture node has no file!", nodeIn);
                }
                const textureFileName = String(nodeIn.resolvedPath || '').replace("./", "");
                const channel = String(mainMaterial[parameterName].inputName || 'rgb').toLowerCase();
                if (!textureFileName) {
                    this._material[materialParameterMapName] = undefined;
                    resolve();
                    return;
                }
                // For debugging
                const matName = Object.keys(this._nodes).find(key => this._nodes[key] === mainMaterial);
                const texturePromise = typeof this._interface.loadMaterialTexture === 'function'
                    ? this._interface.loadMaterialTexture(textureFileName, {
                        stageSourcePath: this._interface.getStageSourcePath?.(),
                    })
                    : this._interface.registry.getTexture(textureFileName);
                texturePromise.then(texture => {
                    if (!this._material) {
                        console.error("Material not set when trying to assign texture, this is likely a bug");
                        resolve();
                    }
                    if (materialParameterMapName === 'alphaMap') {
                        // If this is an opacity map, check if it's using the alpha channel of the diffuse map.
                        // If so, simply change the format of that diffuse map to RGBA and make the material transparent.
                        // If not, we need to copy the alpha channel into a new texture's green channel, because that's what Three.js
                        // expects for alpha maps (not supported at the moment).
                        // NOTE that this only works if diffuse maps are always set before opacity maps, so the order of
                        // 'assingTexture' calls for a material matters.
                        if (nodeIn.file === mainMaterial.diffuseColor?.nodeIn?.file && channel === 'a') {
                            this._material.map.format = RGBAFormat;
                        }
                        else {
                            // TODO: Extract the alpha channel into a new RGB texture.
                            console.error("Separate alpha channel is currently not supported.", nodeIn.file, mainMaterial.diffuseColor?.nodeIn?.file, channel);
                        }
                        if (!(this._material.alphaTest > 0))
                            this._material.transparent = true;
                        this._material.needsUpdate = true;
                        resolve();
                        return;
                    }
                    else if (materialParameterMapName === 'metalnessMap') {
                        this._material.metalness = 1.0;
                    }
                    else if (materialParameterMapName === 'roughnessMap') {
                        this._material.roughness = 1.0;
                    }
                    else if (materialParameterMapName === 'emissiveMap') {
                        this._material.emissive = new Color(0xffffff);
                    }
                    else if (!HydraMaterial.channelMap[channel]) {
                        console.error(`Unsupported texture channel '${channel}'!`);
                        resolve();
                        return;
                    }
                    // TODO need to apply bias/scale to the texture in some cases.
                    // May be able to extract that for metalness/roughness/opacity/normalScale
                    // Clone texture and set the correct format.
                    const clonedTexture = texture.clone();
                    let targetSwizzle = 'rgba';
                    if (materialParameterMapName == 'roughnessMap' && channel != 'g') {
                        targetSwizzle = '0' + channel + '11';
                    }
                    if (materialParameterMapName == 'metalnessMap' && channel != 'b') {
                        targetSwizzle = '01' + channel + '1';
                    }
                    if (materialParameterMapName == 'aoMap' && channel != 'r') {
                        targetSwizzle = channel + '111';
                    }
                    if (materialParameterMapName == 'alphaMap' && channel != 'a') {
                        targetSwizzle = channel + channel + channel + channel;
                    }
                    clonedTexture.colorSpace = HydraMaterial.usdPreviewTextureColorSpaceMap[parameterName] || LinearSRGBColorSpace;
                    // clonedTexture.image = HydraMaterial._swizzleImageChannels(clonedTexture.image, targetSwizzle);
                    // if (materialParameterToTargetChannel[materialParameterMapName] && channel != materialParameterToTargetChannel[materialParameterMapName])
                    if (targetSwizzle != 'rgba') {
                        clonedTexture.image = HydraMaterial._swizzleImageChannels(clonedTexture.image, targetSwizzle);
                    }
                    // clonedTexture.image = HydraMaterial._swizzleImageChannels(clonedTexture.image, channel, 'g')
                    clonedTexture.format = HydraMaterial.channelMap[channel];
                    clonedTexture.needsUpdate = true;
                    if (nodeIn.st && nodeIn.st.nodeIn) {
                        const uvData = nodeIn.st.nodeIn;
                        // TODO this is messed up but works for scale and translation, not really for rotation.
                        // Refer to https://github.com/mrdoob/three.js/blob/e5426b0514a1347d7aafca69aa34117503c1be88/examples/jsm/exporters/USDZExporter.js#L461
                        // (which is also not perfect but close)
                        const rotation = uvData.rotation ? (uvData.rotation / 180 * Math.PI) : 0;
                        const offset = uvData.translation ? new Vector2(uvData.translation[0], uvData.translation[1]) : new Vector2(0, 0);
                        const repeat = uvData.scale ? new Vector2(uvData.scale[0], uvData.scale[1]) : new Vector2(1, 1);
                        const xRotationOffset = Math.sin(rotation);
                        const yRotationOffset = Math.cos(rotation);
                        offset.y = offset.y - (1 - yRotationOffset) * repeat.y;
                        offset.x = offset.x - xRotationOffset * repeat.x;
                        // offset.y = 1 - offset.y - repeat.y;
                        /*
                        if (uvData.scale)
                          clonedTexture.repeat.set(uvData.scale[0], uvData.scale[1]);
                        if (uvData.translation)
                          clonedTexture.offset.set(uvData.translation[0], uvData.translation[1]);
                        if (uvData.rotation)
                        clonedTexture.rotation = uvData.rotation / 180 * Math.PI;
                        */
                        clonedTexture.repeat.set(repeat.x, repeat.y);
                        clonedTexture.offset.set(offset.x, offset.y);
                        clonedTexture.rotation = rotation;
                    }
                    // TODO use nodeIn.wrapS and wrapT and map to THREE
                    clonedTexture.wrapS = this.convertWrap(nodeIn.wrapS);
                    clonedTexture.wrapT = this.convertWrap(nodeIn.wrapT);
                    this._material[materialParameterMapName] = clonedTexture;
                    this._material.needsUpdate = true;
                    resolve();
                    return;
                }).catch(err => {
                    console.error("Error when loading texture", err);
                    resolve();
                    return;
                });
            }
            else {
                resolve();
                return;
            }
        });
    }
    // from https://github.com/mrdoob/three.js/blob/dev/src/math/ColorManagement.js
    static SRGBToLinear(c) {
        return (c < 0.04045) ? c * 0.0773993808 : Math.pow(c * 0.9478672986 + 0.0521327014, 2.4);
    }
    static LinearToSRGB(c) {
        return (c < 0.0031308) ? c * 12.92 : 1.055 * (Math.pow(c, 0.41666)) - 0.055;
    }
    /**
     * Swizzle image channels (e.g. move red channel to green channel)
     * @param {*} image three.js image
     * @param {string} swizzle For example, "rgga". Must have max. 4 components. Can contain 0 and 1, e.g. "rgba1" is valid.
     * @returns three.js image
     */
    static _swizzleImageChannels(image, swizzle) {
        if ((typeof HTMLImageElement !== 'undefined' && image instanceof HTMLImageElement) ||
            (typeof HTMLCanvasElement !== 'undefined' && image instanceof HTMLCanvasElement) ||
            (typeof ImageBitmap !== 'undefined' && image instanceof ImageBitmap)) {
            const canvas = typeof document !== 'undefined'
                ? document.createElementNS('http://www.w3.org/1999/xhtml', 'canvas')
                : (typeof OffscreenCanvas !== 'undefined'
                    ? new OffscreenCanvas(image.width, image.height)
                    : null);
            if (!canvas) {
                return image;
            }
            canvas.width = image.width;
            canvas.height = image.height;
            const context = canvas.getContext('2d');
            if (!context) {
                return image;
            }
            context.drawImage(image, 0, 0, image.width, image.height);
            const imageData = context.getImageData(0, 0, image.width, image.height);
            const data = imageData.data;
            const swizzleToIndex = {
                'r': 0,
                'g': 1,
                'b': 2,
                'a': 3,
                'x': 0,
                'y': 1,
                'z': 2,
                'w': 3,
                '0': 4, // set to 0
                '1': 5, // set to 1
                '-': -1, // passthrough
            };
            const arrayAccessBySwizzle = [4, 4, 4, 4]; // empty value if nothing defined in the swizzle pattern
            for (let i = 0; i < swizzle.length; i++) {
                arrayAccessBySwizzle[i] = swizzleToIndex[swizzle[i]];
            }
            const dataEntry = data.slice(0);
            for (let i = 0; i < data.length; i += 4) {
                dataEntry[0] = data[i];
                dataEntry[1] = data[i + 1];
                dataEntry[2] = data[i + 2];
                dataEntry[3] = data[i + 3];
                dataEntry[4] = 0; // empty value
                dataEntry[5] = 255;
                const rAccess = arrayAccessBySwizzle[0];
                const gAccess = arrayAccessBySwizzle[1];
                const bAccess = arrayAccessBySwizzle[2];
                const aAccess = arrayAccessBySwizzle[3];
                if (rAccess !== -1)
                    data[i] = dataEntry[rAccess];
                if (gAccess !== -1)
                    data[i + 1] = dataEntry[gAccess];
                if (bAccess !== -1)
                    data[i + 2] = dataEntry[bAccess];
                if (aAccess !== -1)
                    data[i + 3] = dataEntry[aAccess];
            }
            context.putImageData(imageData, 0, 0);
            return canvas;
        }
        else if (image.data) {
            const data = image.data.slice(0);
            for (let i = 0; i < data.length; i++) {
                if (data instanceof Uint8Array || data instanceof Uint8ClampedArray) {
                    data[i] = Math.floor(this.SRGBToLinear(data[i] / 255) * 255);
                }
                else {
                    // assuming float
                    data[i] = this.SRGBToLinear(data[i]);
                }
            }
            return {
                data: data,
                width: image.width,
                height: image.height
            };
        }
        else {
            console.error('ImageUtils.sRGBToLinear(): Unsupported image type. No color space conversion applied.');
            return image;
        }
    }
    assignProperty(mainMaterial, parameterName) {
        const materialParameterName = HydraMaterial.usdPreviewToMeshPhysicalMap[parameterName];
        if (materialParameterName === undefined) {
            console.error(`Unsupported material parameter '${parameterName}'.`);
            return;
        }
        if (mainMaterial[parameterName] === undefined || mainMaterial[parameterName]?.nodeIn)
            return;
        const rawValue = mainMaterial[parameterName];
        const emissionEnabled = HydraMaterial._isEmissionEnabled(mainMaterial);
        if (!emissionEnabled && (materialParameterName === 'emissive' || materialParameterName === 'emissiveIntensity')) {
            this._material.emissive = new Color(0x000000);
            this._material.emissiveIntensity = 1;
            return;
        }
        const opacityEnabled = HydraMaterial._isOpacityEnabled(mainMaterial);
        if (!opacityEnabled && (materialParameterName === 'opacity' || materialParameterName === 'alphaTest')) {
            this._material.opacity = 1;
            this._material.alphaTest = 0;
            this._material.transparent = false;
            return;
        }
        if (HydraMaterial.colorMaterialProperties.has(materialParameterName)) {
            const colorTuple = toColorArray(rawValue);
            if (!colorTuple)
                return;
            const colorSpace = HydraMaterial.usdPreviewPropertyColorSpaceMap[parameterName] || null;
            this._material[materialParameterName] = createHydraColorFromTuple(colorTuple, colorSpace);
            return;
        }
        if (HydraMaterial.vector2MaterialProperties.has(materialParameterName)) {
            const vector2Tuple = toFiniteVector2Tuple(rawValue);
            if (!vector2Tuple)
                return;
            this._material[materialParameterName] = new Vector2(vector2Tuple[0], vector2Tuple[1]);
            return;
        }
        const numericValue = toFiniteNumber(rawValue);
        if (numericValue === undefined)
            return;
        let assignedValue = numericValue;
        if (HydraMaterial.clamp01MaterialProperties.has(materialParameterName)) {
            assignedValue = clamp01(assignedValue);
        }
        if (materialParameterName === 'thickness' || materialParameterName === 'attenuationDistance') {
            assignedValue = Math.max(0, assignedValue);
        }
        this._material[materialParameterName] = assignedValue;
        if (materialParameterName === 'opacity' && assignedValue < 1.0) {
            this._material.transparent = true;
        }
        if (materialParameterName === 'alphaTest' && assignedValue > 0.0) {
            this._material.transparent = false;
        }
    }
    async updateFinished(type, relationships) {
        const safeRelationships = Array.isArray(relationships) ? relationships : [];
        for (let relationship of safeRelationships) {
            if (!relationship)
                continue;
            const nodeIn = this._nodes[relationship.inputId];
            const nodeOut = this._nodes[relationship.outputId];
            if (!nodeIn || !nodeOut) {
                continue;
            }
            relationship.nodeIn = nodeIn;
            relationship.nodeOut = nodeOut;
            if (relationship.inputName) {
                relationship.nodeIn[relationship.inputName] = relationship;
            }
            if (relationship.outputName) {
                relationship.nodeOut[relationship.outputName] = relationship;
            }
        }
        const mainMaterialNode = HydraMaterial.resolveMainMaterialNode(this._nodes);
        if (disableMaterials) {
            this._material = getDefaultMaterial();
            return;
        }
        if (!mainMaterialNode) {
            const stageFallbackMaterial = this._interface?.createFallbackMaterialFromStage?.(this._id);
            if (stageFallbackMaterial?._material) {
                this._material = stageFallbackMaterial._material;
                return;
            }
            this._material = getDefaultMaterial();
            return;
        }
        // TODO: Ideally, we don't recreate the material on every update.
        // Creating a new one requires to also update any meshes that reference it. So we're relying on the C++ side to
        // call this before also calling `setMaterial` on the affected meshes.
        // split _id
        let _name = this._id;
        let lastSlash = _name.lastIndexOf('/');
        if (lastSlash >= 0)
            _name = _name.substring(lastSlash + 1);
        const usePhysicalMaterial = HydraMaterial._nodeRequiresPhysicalMaterial(mainMaterialNode);
        this.prepareOwnedMaterial(_name, usePhysicalMaterial);
        // Assign textures
        const hasTextureInput = (candidateKeys) => candidateKeys.some((key) => !!(mainMaterialNode[key] && mainMaterialNode[key].nodeIn));
        const haveRoughnessMap = hasTextureInput(['roughness', 'reflection_roughness']);
        const haveMetalnessMap = hasTextureInput(['metallic', 'metalness']);
        const haveOcclusionMap = hasTextureInput(['occlusion', 'ao', 'ambientOcclusion']);
        if (!disableTextures) {
            /** @type {Array<Promise<any>>} */
            const texturePromises = [];
            for (let key in HydraMaterial.usdPreviewToMeshPhysicalTextureMap) {
                texturePromises.push(this.assignTexture(mainMaterialNode, key));
            }
            await Promise.all(texturePromises);
            // Need to sanitize metallic/roughness/occlusion maps - if we want to export glTF they need to be identical right now
            if (haveRoughnessMap && !haveMetalnessMap) {
                this._material.metalnessMap = this._material.roughnessMap;
                if (this._material.metalnessMap)
                    this._material.metalnessMap.needsUpdate = true;
                else
                    console.error("Something went wrong with the texture promise; haveRoughnessMap is true but no roughnessMap was loaded.");
            }
            else if (haveMetalnessMap && !haveRoughnessMap) {
                this._material.roughnessMap = this._material.metalnessMap;
                if (this._material.roughnessMap)
                    this._material.roughnessMap.needsUpdate = true;
                else
                    console.error("Something went wrong with the texture promise; haveMetalnessMap is true but no metalnessMap was loaded.");
            }
            else if (haveMetalnessMap && haveRoughnessMap) {
                console.error("TODO: [Three USD] separate metalness and roughness textures need to be merged");
            }
        }
        // Assign material properties
        for (let key in HydraMaterial.usdPreviewToMeshPhysicalMap) {
            this.assignProperty(mainMaterialNode, key);
        }
    }
}
// Maps USD preview material texture names to Three.js MeshPhysicalMaterial names
HydraMaterial.usdPreviewToMeshPhysicalTextureMap = {
    'diffuseColor': 'map',
    'baseColor': 'map',
    'base_color': 'map',
    'albedo': 'map',
    'diffuse_color': 'map',
    'diffuse': 'map',
    'clearcoat': 'clearcoatMap',
    'clearcoatRoughness': 'clearcoatRoughnessMap',
    'clearcoatNormal': 'clearcoatNormalMap',
    'emissiveColor': 'emissiveMap',
    'emissive_color': 'emissiveMap',
    'occlusion': 'aoMap',
    'ao': 'aoMap',
    'ambientOcclusion': 'aoMap',
    'roughness': 'roughnessMap',
    'reflection_roughness': 'roughnessMap',
    'reflectionroughness': 'roughnessMap',
    'metallic': 'metalnessMap',
    'metalness': 'metalnessMap',
    'normal': 'normalMap',
    'opacity': 'alphaMap',
    'specularColor': 'specularColorMap',
    'specular_color': 'specularColorMap',
    'specular': 'specularIntensityMap',
    'transmission': 'transmissionMap',
    'thickness': 'thicknessMap',
    'sheenColor': 'sheenColorMap',
    'sheenRoughness': 'sheenRoughnessMap',
    'anisotropy': 'anisotropyMap',
    'iridescence': 'iridescenceMap',
    'iridescenceThickness': 'iridescenceThicknessMap',
};
HydraMaterial.usdPreviewTextureColorSpaceMap = {
    'diffuseColor': SRGBColorSpace,
    'baseColor': SRGBColorSpace,
    'base_color': SRGBColorSpace,
    'base_color_constant': SRGBColorSpace,
    'albedo': SRGBColorSpace,
    'albedo_constant': SRGBColorSpace,
    'diffuse_color': SRGBColorSpace,
    'diffuse_color_constant': SRGBColorSpace,
    'diffuse': SRGBColorSpace,
    'emissiveColor': SRGBColorSpace,
    'emissive_color': SRGBColorSpace,
    'emissive_color_constant': SRGBColorSpace,
    'specularColor': SRGBColorSpace,
    'specular_color': SRGBColorSpace,
};
HydraMaterial.usdPreviewPropertyColorSpaceMap = {};
HydraMaterial.channelMap = {
    // Three.js expects many 8bit values such as roughness or metallness in a specific RGB texture channel.
    // We could write code to combine multiple 8bit texture files into different channels of one RGB texture where it
    // makes sense, but that would complicate this loader a lot. Most Three.js loaders don't seem to do it either.
    // Instead, we simply provide the 8bit image as an RGBA texture, even though this might be less efficient.
    'r': RGBAFormat,
    'g': RGBAFormat,
    'b': RGBAFormat,
    'a': RGBAFormat,
    'rgb': RGBAFormat,
    'rgba': RGBAFormat
};
// Maps USD preview material property names to Three.js MeshPhysicalMaterial names
HydraMaterial.usdPreviewToMeshPhysicalMap = {
    'clearcoat': 'clearcoat',
    'clearcoatRoughness': 'clearcoatRoughness',
    'clearcoatNormalScale': 'clearcoatNormalScale',
    'diffuseColor': 'color',
    'baseColor': 'color',
    'base_color': 'color',
    'base_color_constant': 'color',
    'albedo': 'color',
    'albedo_constant': 'color',
    'diffuse_color': 'color',
    'diffuse_color_constant': 'color',
    'emissiveColor': 'emissive',
    'emissive_color': 'emissive',
    'emissive_color_constant': 'emissive',
    'emissive_intensity': 'emissiveIntensity',
    'ior': 'ior',
    'metallic': 'metalness',
    'metallic_constant': 'metalness',
    'metalness': 'metalness',
    'metalness_constant': 'metalness',
    'opacity': 'opacity',
    'opacity_constant': 'opacity',
    'roughness': 'roughness',
    'roughness_constant': 'roughness',
    'reflection_roughness': 'roughness',
    'reflection_roughness_constant': 'roughness',
    'specular_roughness': 'roughness',
    'opacityThreshold': 'alphaTest',
    'opacity_threshold': 'alphaTest',
    'alphaCutoff': 'alphaTest',
    'alpha_cutoff': 'alphaTest',
    'specular': 'specularIntensity',
    'specular_constant': 'specularIntensity',
    'specularIntensity': 'specularIntensity',
    'specular_intensity': 'specularIntensity',
    'specularColor': 'specularColor',
    'specular_color': 'specularColor',
    'transmission': 'transmission',
    'transmission_weight': 'transmission',
    'thickness': 'thickness',
    'thickness_constant': 'thickness',
    'attenuationDistance': 'attenuationDistance',
    'attenuation_distance': 'attenuationDistance',
    'attenuationColor': 'attenuationColor',
    'attenuation_color': 'attenuationColor',
    'normalScale': 'normalScale',
    'normal_scale': 'normalScale',
    'occlusion': 'aoMapIntensity',
    'occlusion_strength': 'aoMapIntensity',
    'ao_strength': 'aoMapIntensity',
    'ao': 'aoMapIntensity',
    'sheen': 'sheen',
    'sheen_weight': 'sheen',
    'sheenColor': 'sheenColor',
    'sheen_color': 'sheenColor',
    'sheenRoughness': 'sheenRoughness',
    'sheen_roughness': 'sheenRoughness',
    'iridescence': 'iridescence',
    'iridescence_weight': 'iridescence',
    'iridescenceIOR': 'iridescenceIOR',
    'iridescence_ior': 'iridescenceIOR',
    'anisotropy': 'anisotropy',
    'anisotropy_level': 'anisotropy',
    'anisotropyRotation': 'anisotropyRotation',
    'anisotropy_rotation': 'anisotropyRotation',
};
HydraMaterial.colorMaterialProperties = new Set([
    'color',
    'emissive',
    'specularColor',
    'attenuationColor',
    'sheenColor',
]);
HydraMaterial.vector2MaterialProperties = new Set([
    'normalScale',
    'clearcoatNormalScale',
]);
HydraMaterial.clamp01MaterialProperties = new Set([
    'clearcoat',
    'clearcoatRoughness',
    'metalness',
    'roughness',
    'opacity',
    'alphaTest',
    'specularIntensity',
    'transmission',
    'aoMapIntensity',
    'sheen',
    'sheenRoughness',
    'iridescence',
    'anisotropy',
]);
export { HydraMaterial };
