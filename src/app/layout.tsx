import type { Metadata, Viewport } from 'next';
import './globals.css';
export const metadata:Metadata={title:'REPWISE — Every rep counts.',description:'Track smarter. Lift better. Progress with purpose.',manifest:'/manifest.webmanifest',appleWebApp:{capable:true,title:'REPWISE',statusBarStyle:'black-translucent'}};
export const viewport:Viewport={themeColor:'#101010',width:'device-width',initialScale:1};
export default function RootLayout({children}:{children:React.ReactNode}){return <html lang="en"><body>{children}</body></html>}
