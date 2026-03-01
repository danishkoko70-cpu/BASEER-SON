
// Role permission patch for Business Finance
// Drop-in replacement app.js to block Edit/Delete for manager user

(function(){

function isManager(){
    try{
        const txt = document.body.innerText.toLowerCase();
        return txt.includes("user: manager");
    }catch(e){
        return false;
    }
}

function removeManagerButtons(){
    if(!isManager()) return;

    document.querySelectorAll("button").forEach(btn=>{
        const t = (btn.innerText || "").toLowerCase();
        if(t.includes("edit") || t.includes("delete")){
            btn.remove();
        }
    });
}

// block clicks even if button appears
document.addEventListener("click",function(e){
    if(!isManager()) return;

    const t = (e.target.innerText || "").toLowerCase();
    if(t.includes("edit") || t.includes("delete")){
        e.preventDefault();
        e.stopPropagation();
        alert("Manager cannot edit or delete entries.");
    }
},true);

// run repeatedly to ensure removal
document.addEventListener("DOMContentLoaded",removeManagerButtons);
setInterval(removeManagerButtons,1000);

})(); 
