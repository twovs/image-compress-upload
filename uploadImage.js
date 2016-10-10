/**
 *
 *
 * 此代码只需要关注uploadImage方法即可 具体的upload方法自己删除了重新写自己的逻辑即可。
 *
 *
 * @type {number}
 */


var maxsize = 1024 * 1024 * 3;//设置超过多大的图片才压缩，不超过的不压缩直接上传
var expire = 0;//与阿里云相关的 可删除
var ossPolicy, ossSignature, OSSAccessKeyId;//与阿里云相关的  可删除
var ossUploadUrl = '';//此demo使用的是上传到阿里云oss
;(function (window) {
    'use strict'

    var CanvasPrototype = window.HTMLCanvasElement &&
        window.HTMLCanvasElement.prototype
    var hasBlobConstructor = window.Blob && (function () {
            try {
                return Boolean(new Blob())
            } catch (e) {
                return false
            }
        }())
    var hasArrayBufferViewSupport = hasBlobConstructor && window.Uint8Array &&
        (function () {
            try {
                return new Blob([new Uint8Array(100)]).size === 100
            } catch (e) {
                return false
            }
        }())
    var BlobBuilder = window.BlobBuilder || window.WebKitBlobBuilder ||
        window.MozBlobBuilder || window.MSBlobBuilder
    var dataURIPattern = /^data:((.*?)(;charset=.*?)?)(;base64)?,/
    var dataURLtoBlob = (hasBlobConstructor || BlobBuilder) && window.atob &&
        window.ArrayBuffer && window.Uint8Array &&
        function (dataURI) {
            var matches,
                mediaType,
                isBase64,
                dataString,
                byteString,
                arrayBuffer,
                intArray,
                i,
                bb
            // Parse the dataURI components as per RFC 2397
            matches = dataURI.match(dataURIPattern)
            if (!matches) {
                throw new Error('invalid data URI')
            }
            // Default to text/plain;charset=US-ASCII
            mediaType = matches[2]
                ? matches[1]
                : 'text/plain' + (matches[3] || ';charset=US-ASCII')
            isBase64 = !!matches[4]
            dataString = dataURI.slice(matches[0].length)
            if (isBase64) {
                // Convert base64 to raw binary data held in a string:
                byteString = atob(dataString)
            } else {
                // Convert base64/URLEncoded data component to raw binary:
                byteString = decodeURIComponent(dataString)
            }
            // Write the bytes of the string to an ArrayBuffer:
            arrayBuffer = new ArrayBuffer(byteString.length)
            intArray = new Uint8Array(arrayBuffer)
            for (i = 0; i < byteString.length; i += 1) {
                intArray[i] = byteString.charCodeAt(i)
            }
            // Write the ArrayBuffer (or ArrayBufferView) to a blob:
            if (hasBlobConstructor) {
                return new Blob(
                    [hasArrayBufferViewSupport ? intArray : arrayBuffer],
                    {type: mediaType}
                )
            }
            bb = new BlobBuilder()
            bb.append(arrayBuffer)
            return bb.getBlob(mediaType)
        }
    if (window.HTMLCanvasElement && !CanvasPrototype.toBlob) {
        if (CanvasPrototype.mozGetAsFile) {
            CanvasPrototype.toBlob = function (callback, type, quality) {
                if (quality && CanvasPrototype.toDataURL && dataURLtoBlob) {
                    callback(dataURLtoBlob(this.toDataURL(type, quality)))
                } else {
                    callback(this.mozGetAsFile('blob', type))
                }
            }
        } else if (CanvasPrototype.toDataURL && dataURLtoBlob) {
            CanvasPrototype.toBlob = function (callback, type, quality) {
                callback(dataURLtoBlob(this.toDataURL(type, quality)))
            }
        }
    }
    if (typeof define === 'function' && define.amd) {
        define(function () {
            return dataURLtoBlob
        })
    } else if (typeof module === 'object' && module.exports) {
        module.exports = dataURLtoBlob
    } else {
        window.dataURLtoBlob = dataURLtoBlob
    }
}(window));
(function () {
    function detectSubsampling(img) {
        var iw = img.naturalWidth, ih = img.naturalHeight;
        if (iw * ih > 1024 * 1024) { // subsampling may happen over megapixel image
            var canvas = document.createElement('canvas');
            canvas.width = canvas.height = 1;
            var ctx = canvas.getContext('2d');
            ctx.drawImage(img, -iw + 1, 0);
            // subsampled image becomes half smaller in rendering size.
            // check alpha channel value to confirm image is covering edge pixel or not.
            // if alpha value is 0 image is not covering, hence subsampled.
            return ctx.getImageData(0, 0, 1, 1).data[3] === 0;
        } else {
            return false;
        }
    }

    /**
     * Detecting vertical squash in loaded image.
     * Fixes a bug which squash image vertically while drawing into canvas for some images.
     */
    function detectVerticalSquash(img, iw, ih) {
        var canvas = document.createElement('canvas');
        canvas.width = 1;
        canvas.height = ih;
        var ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0);
        var data = ctx.getImageData(0, 0, 1, ih).data;
        // search image edge pixel position in case it is squashed vertically.
        var sy = 0;
        var ey = ih;
        var py = ih;
        while (py > sy) {
            var alpha = data[(py - 1) * 4 + 3];
            if (alpha === 0) {
                ey = py;
            } else {
                sy = py;
            }
            py = (ey + sy) >> 1;
        }
        var ratio = (py / ih);
        return (ratio === 0) ? 1 : ratio;
    }

    /**
     * Rendering image element (with resizing) and get its data URL
     */
    function renderImageToDataURL(img, options, doSquash) {
        var canvas = document.createElement('canvas');
        renderImageToCanvas(img, canvas, options, doSquash);
        return canvas.toDataURL("image/jpeg", options.quality || 0.8);
    }

    /**
     * Rendering image element (with resizing) into the canvas element
     */
    function renderImageToCanvas(img, canvas, options, doSquash) {
        var iw = img.naturalWidth, ih = img.naturalHeight;
        if (!(iw + ih)) return;
        var width = options.width, height = options.height;
        var ctx = canvas.getContext('2d');
        ctx.save();
        transformCoordinate(canvas, ctx, width, height, options.orientation);
        var subsampled = detectSubsampling(img);
        if (subsampled) {
            iw /= 2;
            ih /= 2;
        }
        var d = 1024; // size of tiling canvas
        var tmpCanvas = document.createElement('canvas');
        tmpCanvas.width = tmpCanvas.height = d;
        var tmpCtx = tmpCanvas.getContext('2d');
        var vertSquashRatio = doSquash ? detectVerticalSquash(img, iw, ih) : 1;
        var dw = Math.ceil(d * width / iw);
        var dh = Math.ceil(d * height / ih / vertSquashRatio);
        var sy = 0;
        var dy = 0;
        while (sy < ih) {
            var sx = 0;
            var dx = 0;
            while (sx < iw) {
                tmpCtx.clearRect(0, 0, d, d);
                tmpCtx.drawImage(img, -sx, -sy);
                ctx.drawImage(tmpCanvas, 0, 0, d, d, dx, dy, dw, dh);
                sx += d;
                dx += dw;
            }
            sy += d;
            dy += dh;
        }
        ctx.restore();
        tmpCanvas = tmpCtx = null;
    }

    /**
     * Transform canvas coordination according to specified frame size and orientation
     * Orientation value is from EXIF tag
     */
    function transformCoordinate(canvas, ctx, width, height, orientation) {
        switch (orientation) {
            case 5:
            case 6:
            case 7:
            case 8:
                canvas.width = height;
                canvas.height = width;
                break;
            default:
                canvas.width = width;
                canvas.height = height;
        }
        switch (orientation) {
            case 2:
                // horizontal flip
                ctx.translate(width, 0);
                ctx.scale(-1, 1);
                break;
            case 3:
                // 180 rotate left
                ctx.translate(width, height);
                ctx.rotate(Math.PI);
                break;
            case 4:
                // vertical flip
                ctx.translate(0, height);
                ctx.scale(1, -1);
                break;
            case 5:
                // vertical flip + 90 rotate right
                ctx.rotate(0.5 * Math.PI);
                ctx.scale(1, -1);
                break;
            case 6:
                // 90 rotate right
                ctx.rotate(0.5 * Math.PI);
                ctx.translate(0, -height);
                break;
            case 7:
                // horizontal flip + 90 rotate right
                ctx.rotate(0.5 * Math.PI);
                ctx.translate(width, -height);
                ctx.scale(-1, 1);
                break;
            case 8:
                // 90 rotate left
                ctx.rotate(-0.5 * Math.PI);
                ctx.translate(-width, 0);
                break;
            default:
                break;
        }
    }

    var URL = window.URL && window.URL.createObjectURL ? window.URL :
        window.webkitURL && window.webkitURL.createObjectURL ? window.webkitURL :
            null;

    /**
     * MegaPixImage class
     */
    function MegaPixImage(srcImage) {
        if (window.Blob && srcImage instanceof Blob) {
            if (!URL) {
                throw Error("No createObjectURL function found to create blob url");
            }
            var img = new Image();
            img.src = URL.createObjectURL(srcImage);
            this.blob = srcImage;
            srcImage = img;
        }
        if (!srcImage.naturalWidth && !srcImage.naturalHeight) {
            var _this = this;
            srcImage.onload = srcImage.onerror = function () {
                var listeners = _this.imageLoadListeners;
                if (listeners) {
                    _this.imageLoadListeners = null;
                    for (var i = 0, len = listeners.length; i < len; i++) {
                        listeners[i]();
                    }
                }
            };
            this.imageLoadListeners = [];
        }
        this.srcImage = srcImage;
    }

    /**
     * Rendering megapix image into specified target element
     */
    MegaPixImage.prototype.render = function (target, options, callback) {
        if (this.imageLoadListeners) {
            var _this = this;
            this.imageLoadListeners.push(function () {
                _this.render(target, options, callback);
            });
            return;
        }
        options = options || {};
        var imgWidth = this.srcImage.naturalWidth, imgHeight = this.srcImage.naturalHeight,
            width = options.width, height = options.height,
            maxWidth = options.maxWidth, maxHeight = options.maxHeight,
            doSquash = !this.blob || this.blob.type === 'image/jpeg';
        if (width && !height) {
            height = (imgHeight * width / imgWidth) << 0;
        } else if (height && !width) {
            width = (imgWidth * height / imgHeight) << 0;
        } else {
            width = imgWidth;
            height = imgHeight;
        }
        if (maxWidth && width > maxWidth) {
            width = maxWidth;
            height = (imgHeight * width / imgWidth) << 0;
        }
        if (maxHeight && height > maxHeight) {
            height = maxHeight;
            width = (imgWidth * height / imgHeight) << 0;
        }
        var opt = {width: width, height: height};
        for (var k in options) opt[k] = options[k];

        var tagName = target.tagName.toLowerCase();
        if (tagName === 'img') {
            target.src = renderImageToDataURL(this.srcImage, opt, doSquash);
        } else if (tagName === 'canvas') {
            renderImageToCanvas(this.srcImage, target, opt, doSquash);
        }
        if (typeof this.onrender === 'function') {
            this.onrender(target);
        }
        if (callback) {
            callback();
        }
        if (this.blob) {
            this.blob = null;
            URL.revokeObjectURL(this.srcImage.src);
        }
    };

    /**
     * Export class to global
     */
    if (typeof define === 'function' && define.amd) {
        define([], function () {
            return MegaPixImage;
        }); // for AMD loader
    } else if (typeof exports === 'object') {
        module.exports = MegaPixImage; // for CommonJS
    } else {
        this.MegaPixImage = MegaPixImage;
    }

})();
/**
 * 上传图片入口方法--这个方法自己随意修改。
 * @param file  文件
 * @param userId
 * @param locationKey
 */
function uploadImage(file, userId, locationKey) {
    var reader = new FileReader();
    //当下面的reader.readAsDataURL(file);执行后就会自动执行这儿
    reader.onload = function () {
        var result = this.result;
        var img = new Image();
        img.src = result;
        //如果图片大小小于 max kb，则直接上传
        if (result.length <= maxsize) {
            img = null; //将此img对象还原 防止被重复使用
            $("#liveImg").val('');//这个liveimg就是绑定了change方法的标签元素 需要修改成自己的
            upload(result, file.type, userId, locationKey);
            return;
        }
        if (img.complete) {
            callback();
        } else {
            img.onload = callback;
        }
        //加载完图片进行压缩
        function callback() {
            zip(img, userId, locationKey);
        }
    };
    //当这儿读取完成后就会执行 onload
    reader.readAsDataURL(file);
}
/**
 * 压缩调用方法
 * @param img
 * @returns {string}
 */
function zip(img, userId, locationKey) {
    $("#liveImg").val('');//这个liveimg就是绑定了change方法的标签元素 需要修改成自己的
    var canvas = document.createElement("canvas");
    var ctx = canvas.getContext('2d');
    var width = img.width;
    var height = img.height;
    //如果图片大于1百万像素，计算压缩比并将大小压至100万以下
    var ratio;
    if ((ratio = width * height / 1000000) > 1) {
        if (width / height > 3 || width / height < 0.33) {
            alert('暂不支持长图和全景图');
            return;
        }
        ratio = Math.sqrt(ratio);
        width /= ratio;
        height /= ratio;
        canvas.width = width;
        canvas.height = height;
        var mpImg = new MegaPixImage(img);
        mpImg.render(canvas, {width: canvas.width, height: canvas.height})
    } else {
        ctx.drawImage(img, 0, 0, width, height);
    }
    canvas.toBlob(
        function (blob) {
            ossUpload(blob, 'image/jpeg', userId, locationKey);
        },
        'image/jpeg'
    );
}
/**
 * 正常不压缩的上传方法
 * @param basestr
 * @param type  图片类型
 * @param userId 这个是用来给文件起名字用的 可根据自己的逻辑修改
 * @param locationKey  要上传的相对路径名字
 */
function upload(basestr, type, userId, locationKey) {
    var text = window.atob(basestr.split(",")[1]);
    var buffer = new Uint8Array(text.length);
    for (var i = 0; i < text.length; i++) {
        buffer[i] = text.charCodeAt(i);
    }
    var blob = getBlob([buffer], type);
    var formdata = new FormData();
    var fileName;
    if (locationKey == "live/") {
        fileName = userId.substr(40) + Date.parse(new Date()) / 1000 + "." + "jpg";
    } else {
        fileName = userId.substr(32) + "." + "jpg";
    }
    var key = locationKey + fileName;
    getAccessId();
    formdata.append("key", key);
    formdata.append("Content-Type", type);
    formdata.append("OSSAccessKeyId", OSSAccessKeyId);
    formdata.append("success_action_status", 200);
    formdata.append("policy", ossPolicy);
    formdata.append("signature", ossSignature);
    formdata.append("file", blob);
    var xhr = createXmlHttpRequest('POST', ossUploadUrl);
    xhr.onreadystatechange = function () {
        if (xhr.readyState == 4 && xhr.status == 200) {
            //TODO 上传成功自己处理逻辑
        }
    };
    xhr.send(formdata);
}
/**
 * oss压缩后的上传方法
 * @param blob
 * @param type  图片类型
 * @param userId 这个是用来给文件起名字用的 可根据自己的逻辑修改
 * @param locationKey  要上传的相对路径名字
 */
function ossUpload(blob, type, userId, locationKey) {
    var formdata = new FormData();
    //此处修改为自己的逻辑
    var fileName;
    if (locationKey == "live/") {
        fileName = userId.substr(40) + Date.parse(new Date()) / 1000 + "." + "jpg";
    } else {
        fileName = userId.substr(32) + "." + "jpg";
    }
    var key = locationKey + fileName;
    getAccessId();//此处获取阿里云oss的上传密钥等。
    formdata.append("key", key);
    formdata.append("Content-Type", type);
    formdata.append("OSSAccessKeyId", OSSAccessKeyId);
    formdata.append("success_action_status", 200);
    formdata.append("policy", ossPolicy);
    formdata.append("signature", ossSignature);
    formdata.append("file", blob);
    var xhr = createXmlHttpRequest('POST', ossUploadUrl);
    xhr.onreadystatechange = function () {
        if (xhr.readyState == 4 && xhr.status == 200) {
            //TODO 上传成功自己处理逻辑
        }
    };
    xhr.send(formdata);
}
/**
 * 创建xhr
 * @param method
 * @param url
 * @returns {XMLHttpRequest}
 */
function createXmlHttpRequest(method, url) {
    var xhr = new XMLHttpRequest();
    if ("withCredentials" in xhr) {
        xhr.open(method, url, true);
    } else if (typeof(xhr) != "undefined") {
        xhr = new XDomainRequest();
        xhr.open(method, url);
    } else {
        xhr = null;
    }
    return xhr;
}
/**
 * 获取blob对象的兼容性写法 根据浏览器内核获取
 * @param buffer
 * @param format
 * @returns {*}
 */
function getBlob(buffer, format) {
    try {
        return new Blob(buffer, {type: format});
    } catch (e) {
        console.log("生成blob发生错误,浏览器不支持");
        var bb = new (window.BlobBuilder || window.WebKitBlobBuilder || window.MSBlobBuilder);
        buffer.forEach(function (buf) {
            bb.append(buf);
        });
        return bb.getBlob(format);
    }
}
/**
 * 获取阿里云临时上传文件KEY sign policy
 */
function getAccessId() {
    var now = Date.parse(new Date()) / 1000;
    if (now - expire > 3600) {
        $.ajax({
            url: '',
            async: false,
            success: function (data) {
                if (data.suc == 200) {
                    ossPolicy = data.data.policy;
                    ossSignature = data.data.signature;
                    OSSAccessKeyId = data.data.accessid;
                    expire = data.data.expire;
                }
            }
        });
    }
}