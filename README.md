# Twitch to Instagram

A free local Windows helper: press a Stream Deck button to publish an OBS screenshot to Instagram with your current Twitch stream title as its caption. No Zapier or paid Stream Deck plugins, and no third-party Node packages.

## How it works

1. Check that Twitch is live and OBS is streaming.
2. Read the live Twitch title and capture the OBS Program scene as a JPEG.
3. Upload the image to your Cloudinary account so Instagram can fetch it.
4. Create an Instagram media container and poll its status until it is ready.
5. Publish once per Twitch broadcast, then remove the temporary Cloudinary image after confirmed publication.

The readiness check addresses Instagram's “The media is not ready to be published” timing error. It checks up to six times at one-minute intervals. A later retry reuses a saved pending container. An ambiguous publication response blocks automatic reposting to reduce duplicate posts.

## Requirements

- Windows, Node.js 22 or later, and PowerShell 7 installed in its standard location.
- OBS with its WebSocket server enabled under Tools → WebSocket Server Settings. The helper reads the existing configuration from the standard OBS user-data folder.
- Stream Deck and its desktop app, with the built-in System → Open action.
- Your own Twitch developer app, Cloudinary Free account, and Instagram professional account with a Meta app configured for Instagram Login.
- Internet access. Cloudinary Free quotas and the providers' API limits apply. This project itself has no subscription fee.

## Set up

1. Clone this repository or download its ZIP and extract it into a permanent folder. Do not run from inside the ZIP.
2. Double-click **Open Setup.vbs**. It opens the local setup page at http://127.0.0.1:17863. If Windows blocks VBScript, run `pwsh -NoProfile -File ./launch.ps1 setup` from this folder.
3. Enter your Twitch channel and the client ID/secret from a Confidential app registered at https://dev.twitch.tv/console/apps. If a redirect URL is requested, use `http://localhost`. Optionally add caption prefix and suffix text; the helper places them around the current Twitch title with spaces.
4. Enter your Cloudinary cloud name, API key, and API secret from https://console.cloudinary.com/. Use the Free plan.
5. At https://developers.facebook.com/apps/, configure Instagram Login for your own Meta app, add your Instagram account as a tester if using development mode, accept the tester invitation, and generate a token. Allow `instagram_business_basic` and `instagram_business_content_publish`. Copy the Instagram account ID and access token into Setup. Do not share the token. Meta account eligibility and app-access requirements still apply.
6. Choose **Save connections securely**, **Check connections**, and **Capture local preview**. These checks do not upload or publish a screenshot.
7. Review the preview, then choose **Enable Stream Deck posting**.
8. In Stream Deck, add **System → Open**, select **Post to Instagram.vbs**, and label the button **POST LIVE**. Add an optional second button for **Open Setup.vbs**, labelled **SETUP**.

For a standard 15-key Stream Deck, you can instead run `pwsh -NoProfile -File ./Build-StreamDeckProfile.ps1`, then open the generated `.streamDeckProfile` file and import it. Choose **Twitch to Instagram** from the profile dropdown. The generated profile contains absolute paths for this checkout, so regenerate it if you move the folder. For other devices, add the two buttons manually.

Go live in OBS/Twitch, then press POST LIVE. The launcher starts the helper when needed and displays its result. Do not use an old Zapier announcement button at the same time unless you intend separate posts.

## Restore or move to another PC

Download this repository again, install the requirements, and reconnect your accounts through Setup. Credentials are intentionally absent from GitHub. Windows encrypts saved settings for the local Windows account; they are not a portable cross-PC credential backup. Recreate or reimport the Stream Deck buttons after choosing the permanent folder.

On the original PC, keep the existing `.private` folder when updating the helper in place. It contains encrypted settings, the local preview, and the duplicate-prevention history. Never delete posting history to retry an uncertain publication: check Instagram first. A fresh installation has no memory of earlier posts, so avoid posting the same broadcast from both installations.

## Privacy and limitations

- Secrets stay in `.private/settings.dpapi`, protected with Windows DPAPI. Temporary credential-transfer files are also encrypted. Do not commit or share `.private`, even in a private repository.
- The server binds only to `127.0.0.1:17863` and checks Host and Origin headers. It opens no public network listener.
- Only the OBS scene is captured. Setup previews stay local. Posting sends the screenshot to Cloudinary and Meta and the title to Meta. The hosted image is public until cleanup.
- Failed or abandoned uploads can leave images in Cloudinary. Review those in your console before removing them.
- Standard 16:9 scenes fit. Unsupported aspect ratios are rejected. In OBS Studio Mode, use different Program and Preview scenes.
- Instagram tokens can expire or be revoked. Automatic token renewal is not implemented; replace the token in Setup, check connections, and re-enable posting.
- The default API version is v24.0 and can be changed in Advanced settings when necessary.
- The Facebook Login option is for an existing Page-linked configuration; this guide uses Instagram Login.

## Review and tests

`npm test` runs offline tests for readiness polling, duplicate handling, image proportions, and encrypted storage. The Windows credential test is skipped on other operating systems. In environments that block Node child-process test workers, use `node --test --test-isolation=none tests/*.test.mjs` with Node 22.8 or later.

The initial setup verified OBS capture and live account connectivity, including Instagram publishing access, and imported the Stream Deck profile. **An actual Instagram publication has not yet been verified end to end.** Treat the first live post as the final integration test.

Main files: `app.mjs` manages local setup and posting; `core.mjs` handles service APIs and OBS; `vault.mjs` and `secrets.ps1` protect settings; `launch.ps1` and the VBS files launch the helper; `tests/` contains the offline checks.

## Official references

- [Twitch Get Streams](https://dev.twitch.tv/docs/api/reference#get-streams)
- [OBS WebSocket protocol](https://github.com/obsproject/obs-websocket/blob/master/docs/generated/protocol.md)
- [Meta Instagram API collection](https://www.postman.com/meta/workspace/instagram/documentation/23987686-9386f468-7714-490f-9bfc-9442db5c8f00)
- [Cloudinary uploads](https://cloudinary.com/documentation/upload_images)

No open-source licence has been selected yet. Public visibility lets others inspect the project; it does not itself grant a reuse licence.
