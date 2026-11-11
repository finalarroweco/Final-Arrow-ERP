"use client";
import {useRef} from "react";
import {BankReadIdentity} from "../read-identity";
import {CertificateWidget} from "../certificates/widget";
import {ReconciliationPanel,type ReconciliationProps} from "./panel";
export function ReconciliationWorkspace({canCreate,...props}:ReconciliationProps&{canCreate:boolean}){
 const identity=useRef(new BankReadIdentity()).current;
 return <><ReconciliationPanel {...props} readIdentity={identity}/><CertificateWidget actorId={props.actorId} tenantId={props.tenantId} statementId={props.id} locale={props.locale} canCreate={canCreate} readIdentity={identity}/></>;
}
