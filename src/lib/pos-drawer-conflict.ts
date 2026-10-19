export function drawerConflictMessage(error:unknown):string|null{
 if(!(error instanceof Error)||error.name!=="PrismaClientUnknownRequestError"||!error.message.includes('code: "23514"'))return null;
 if(error.message.includes("Insufficient recorded drawer cash"))return "Insufficient drawer cash. Record the actual cash in before this movement.";
 if(error.message.includes("Open a branch shift"))return "Open a branch shift before recording payments or refunds.";
 if(error.message.includes("Shift is closed or reached 5000 events"))return "The shift is closed or full. Close the full shift and open another.";
 return null;
}
