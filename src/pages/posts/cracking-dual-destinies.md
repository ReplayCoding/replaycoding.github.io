---
title: 'Cracking Ace Attorney so I can play it offline'
layout: '/src/layouts/MarkdownBlogPost.astro'
---
*Phoenix Wright: Ace Attorney - Dual Destinies* is one of my favourite games on the 3DS. Recently I bought the Android version since I knew that it had debug symbols and I wanted to mod the game. But when I installed it I discovered that I needed to be online to launch it, or it would just show a "Transmission Error" dialog. Since I wanted to mod the game anyways, I thought it would be a fun project to try and remove the DRM.

## Tracing _getSignature_
After getting the APK and expansion data onto my computer for static analysis, I wanted to be able to perform dynamic analysis as well. [Frida](https://frida.re/) is a tool for this that I've used before, so that's what I used. Because I don't have a rooted device, I had to use Frida's "gadget" library which requires modifying the target application to load it. But after rebuilding and installing the modified application, I got a different "Signature Error" dialog.

Now that I had Frida running, I could trace what the application is doing internally. By using frida-trace to trace the Java methods that got called, I noticed that there were some interesting calls to a method named `getSignature`, followed by a call to `showSignatureConfirmDialog`:
```java
1171 ms  MTFPActivity.getSignature()
1173 ms  <= "3082035b30820243a00302..."
1173 ms  MTFPActivity.getSignature()
1173 ms  <= "3082035b30820243a00302..."
1175 ms  MTFPActivity.getSystemFontDataNum()
1175 ms  <= 0
        /* TID 0x757a */
1195 ms  MTFPActivity.onSensorChanged("<instance: android.hardware.SensorEvent>")
...
        /* TID 0x75bb */
1204 ms  MTFPActivity.showSignatureConfirmDialog()
1204 ms     | MTFPActivity.setLVLState(0)
1206 ms     | MTFPActivity.s("<instance: jp.co.capcom.android.mtfp.MTFPActivity$o>")
```

Curious to see where this was getting called from, I grepped for those methods and found one specific file of interest: `libGS5_Android.so`. This is the C++ library containing the majority of the game code.

## Reversing the native library
After searching for references to `getSignature` in the library, I found this code in `aScrnCheck::move`:
```armasm
bl      native::android::getJavaActivity
mov     x20, x0
mov     x0, x21  {data_e5c9e7, "MTFPActivity"}
bl      native::android::getJavaClass
mov     x1, x0
mov     x0, x20
mov     x2, x22  {data_e5cea6, "getSignature"}
mov     x3, x23  {data_e5ceb3, "()Ljava/lang/String;"}
bl      native::android::callJavaMethod<_jobject*>
mov     x20, x0
bl      native::android::getJNIEnv
ldr     x8, [x0]
mov     x1, x20
mov     x2, xzr  {0x0}
ldr     x8, [x8, #0x548 {JNINativeInterface_::GetStringUTFChars}]
blr     x8
adrp    x1, 0xe5c000
add     x1, x1, #0xa01  {data_e5ca01, "308202333082019ca00302010…"}
bl      strcmp
```
This calls `getSignature` through JNI and then compares the result against a hardcoded string. If the value doesn't match, it will later call the `showSignatureConfirmDialog` of `MTFPActivity` which shows the error dialog. So to bypass this check, I can just replace `getSignature` with a method that returns the hardcoded string:

```smali
.method public getSignature()Ljava/lang/String;
    .locals 1
    const-string v0, "308202333082019ca0030201..."
    return-object v0
.end method
```

After rebuilding the app with these changes and launching it again, it went back to showing the original "Transmission Error" dialog.

## Patching out the LVL checks
Conveniently, this dialog has a retry button which runs whatever checks the application is doing, so it was fairly easy to find the code responsible for the checks by using frida-trace again. After trying to wrap my head around the code that was called for a while, I stumbled on a [repository for something called LVL](https://github.com/google/play-licensing) by googling for constants in the code. It turns out that this is an open-source library for checking licenses using Google Play, which sounds like the exactly the kind of thing that I'd need to patch.

The way LVL works is that the application calls the [`checkAccess`](https://github.com/google/play-licensing/blob/ac02e222a7c2842158103484fbd7fd2a440c364e/lvl_library/src/main/java/com/google/android/vending/licensing/LicenseChecker.java#L140) method of the `LicenseChecker` class, providing an implementation of the `LicenseCheckerCallback` interface. LVL will then call the `allow`, `dontAllow`, or `applicationError` method of the callback at some later point in time. If `allow` is called, then the application knows that the user has been verified, and can continue. The simplest way to bypass this is to replace the `checkAccess` method with one that always calls `allow`. Conveniently, `checkAccess` already has a piece of code that calls `allow` directly, so it was just a matter of deleting the surrounding code, leaving me with this:
```smali
.method public declared-synchronized f(Ljp/co/capcom/android/mtfp/c0;)V
    .locals 1
    # Policy.LICENSED
    const/16 v0, 0x100
    # allow(int reason)
    invoke-interface {p1, v0}, Ljp/co/capcom/android/mtfp/c0;->a(I)V
    return-void
.end method
```

After rebuilding the application with both patches, it booted into the game offline 🎉

![The Dual Destinies title screen](../../assets/cracking-dual-destinies/working-title-screen.png)