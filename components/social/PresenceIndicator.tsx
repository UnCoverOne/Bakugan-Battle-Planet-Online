import {socialPresenceDisplay,type SocialAccountSummary} from "../../lib/social";
import styles from "./PresenceIndicator.module.css";

export function PresenceIndicator({account,suffix="",unavailable=false,iconOnly=false}:{
  account?:Pick<SocialAccountSummary,"online"|"presence">;
  suffix?:string;
  unavailable?:boolean;
  iconOnly?:boolean;
}){
  const {label,tone,away}=account?socialPresenceDisplay(account):{label:unavailable?"Presence unavailable":"Checking status…",tone:"offline",away:false};
  const description=away&&label!=="Away"?label+" (Away)":label;
  return <small className={styles.presence} data-icon-only={iconOnly||undefined} data-tone={tone} title={description} aria-label={description+suffix}>
    <i aria-hidden="true"/>{!iconOnly&&<>{label}{suffix}</>}
  </small>;
}
