package cn.cpa26.workbook;
import android.app.Activity;
import android.os.Bundle;
import android.webkit.*;
import android.content.Intent;
import android.net.Uri;
import android.net.wifi.WifiManager;
import android.security.KeyPairGeneratorSpec;
import android.util.Base64;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.security.*;
import java.math.BigInteger;
import java.util.*;
import java.util.concurrent.*;
import javax.net.ssl.*;
import javax.security.auth.x500.X500Principal;
import org.json.*;

public final class MainActivity extends Activity {
    WebView web; PeerNode node; WifiManager.MulticastLock lock;
    ExecutorService tasks=Executors.newSingleThreadExecutor();
    public static final String BANK_ID="BANK_PLACEHOLDER";
    public void onCreate(Bundle state) {
        super.onCreate(state);
        web=new WebView(this);setContentView(web);
        WebSettings settings=web.getSettings();settings.setJavaScriptEnabled(true);settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(false);settings.setAllowContentAccess(false);
        web.setWebChromeClient(new WebChromeClient());
        web.setWebViewClient(new WebViewClient(){
            public WebResourceResponse shouldInterceptRequest(WebView view,WebResourceRequest request){
                Uri url=request.getUrl();
                if(!"https".equalsIgnoreCase(url.getScheme())||!"appassets.androidplatform.net".equalsIgnoreCase(url.getHost())
                    ||(url.getPort()!=-1&&url.getPort()!=443)||!("/".equals(url.getPath())||"/index.html".equals(url.getPath())))return null;
                try {
                    return new WebResourceResponse("text/html","UTF-8",getAssets().open("index.html"));
                }catch(IOException e){
                    byte[] message="无法读取内置题库，请重启应用后重试。".getBytes(StandardCharsets.UTF_8);
                    return new WebResourceResponse("text/plain","UTF-8",new ByteArrayInputStream(message));
                }
            }
            public boolean shouldOverrideUrlLoading(WebView view,String url){
                if(url.startsWith("https://appassets.androidplatform.net/"))return false;
                if(url.startsWith("https://")||url.startsWith("http://"))try{startActivity(new Intent(Intent.ACTION_VIEW,Uri.parse(url)));}catch(Exception ignored){}
                return true;
            }
        });
        web.addJavascriptInterface(new Bridge(),"CpaNative");
        web.loadUrl("https://appassets.androidplatform.net/");
        tasks.execute(new Runnable(){public void run(){try{
            KeyStore keys=KeyStore.getInstance("AndroidKeyStore");keys.load(null);
            String alias="cpa-lan-tls-v1";
            if(!keys.containsAlias(alias)){
                Calendar start=Calendar.getInstance(),end=Calendar.getInstance();end.add(Calendar.YEAR,20);
                KeyPairGenerator generator=KeyPairGenerator.getInstance("RSA","AndroidKeyStore");
                generator.initialize(new KeyPairGeneratorSpec.Builder(MainActivity.this).setAlias(alias).setSubject(new X500Principal("CN=CPA LAN")).setSerialNumber(BigInteger.ONE).setStartDate(start.getTime()).setEndDate(end.getTime()).setKeySize(2048).build());generator.generateKeyPair();
            }
            KeyManagerFactory km=KeyManagerFactory.getInstance(KeyManagerFactory.getDefaultAlgorithm());km.init(keys,null);
            SSLContext context=SSLContext.getInstance("TLS");context.init(km.getKeyManagers(),null,new SecureRandom());
            String fingerprint=PeerNode.hex(MessageDigest.getInstance("SHA-256").digest(keys.getCertificate(alias).getEncoded()));
            try {WifiManager wifi=(WifiManager)getApplicationContext().getSystemService(WIFI_SERVICE);lock=wifi.createMulticastLock("cpa-study-discovery");lock.setReferenceCounted(false);lock.acquire();}catch(Exception ignored){}
            node=new PeerNode(context,fingerprint,new File(getFilesDir(),"peer-sync"),android.os.Build.MODEL,BANK_ID,PeerNode.DISCOVERY_PORT);
        }catch(Exception e){startupError=e.toString();}}});
    }
    volatile String startupError;
    final class Bridge {
        @JavascriptInterface public void request(final String requestId,final String json) {
            tasks.execute(new Runnable(){public void run(){String response;
                try {if(node==null)throw new IOException(startupError==null?"同步正在启动，请稍后重试":startupError);
                    response=new JSONObject().put("ok",true).put("result",node.local(new JSONObject(json))).toString();
                }catch(Exception e){try{response=new JSONObject().put("ok",false).put("error",e.getMessage()).toString();}catch(Exception ignored){response="{\"ok\":false,\"error\":\"同步失败\"}";}}
                final String script="window.__cpaPeerReply("+JSONObject.quote(requestId)+","+response+");";
                runOnUiThread(new Runnable(){public void run(){if(web!=null)web.evaluateJavascript(script,null);}});
            }});
        }
    }
    public void onBackPressed(){web.evaluateJavascript("(function(){if(window.cpaCloseOverlay&&window.cpaCloseOverlay())return true;var p=document.getElementById('practiceApp');if(p&&!p.hidden){document.getElementById('changeSubject').click();return true}return false})()",new ValueCallback<String>(){public void onReceiveValue(String value){if(!"true".equals(value))finish();}});}
    protected void onDestroy(){if(node!=null)node.close();if(lock!=null&&lock.isHeld())lock.release();tasks.shutdownNow();if(web!=null){web.removeJavascriptInterface("CpaNative");web.destroy();web=null;}super.onDestroy();}
}
